from __future__ import annotations

import hashlib
import json
import math
import secrets
from typing import Any

from .configuration import ConfigError, KlipperConfigRepository
from .printer import PrinterAdapter
from .wizard import WizardError

SETUP_SCHEMAS: dict[str, dict[str, Any]] = {
    "bed_mesh": {
        "section": "bed_mesh",
        "kind": "mesh",
        "fields": ["mesh_min", "mesh_max", "probe_count", "speed", "horizontal_move_z"],
    },
    "screws_tilt": {
        "section": "screws_tilt_adjust",
        "kind": "named_points",
        "min_points": 3,
        "max_points": 12,
        "fields": ["points", "speed", "horizontal_move_z", "screw_thread"],
    },
    "bed_screws": {
        "section": "bed_screws",
        "kind": "named_points",
        "min_points": 3,
        "max_points": 12,
        "fields": ["points", "speed", "horizontal_move_z", "probe_height"],
    },
    "z_tilt": {
        "section": "z_tilt",
        "kind": "dual_points",
        "min_points": 2,
        "max_points": 8,
        "fields": [
            "z_positions",
            "points",
            "speed",
            "horizontal_move_z",
            "retries",
            "retry_tolerance",
        ],
    },
    "quad_gantry_level": {
        "section": "quad_gantry_level",
        "kind": "quad_gantry",
        "fields": [
            "gantry_corners",
            "points",
            "speed",
            "horizontal_move_z",
            "retries",
            "retry_tolerance",
            "max_adjust",
        ],
    },
}


class CalibrationSetupManager:
    def __init__(self, printer: PrinterAdapter, config: KlipperConfigRepository | None) -> None:
        self.printer = printer
        self.config = config
        self._previews: dict[str, tuple[str, dict[str, str], str]] = {}

    async def describe(self, wizard: str) -> dict[str, Any]:
        schema = self._schema(wizard)
        status = await self.printer.query_objects({"configfile": ["settings"]})
        settings = status.get("configfile", {}).get("settings", {})
        current = settings.get(schema["section"], {})
        bounds = {}
        for axis in ("x", "y"):
            stepper = settings.get(f"stepper_{axis}", {})
            bounds[axis] = {
                "min": stepper.get("position_min", 0),
                "max": stepper.get("position_max"),
            }
        return {
            "wizard": wizard,
            "schema": schema,
            "current": current,
            "printer_bounds": bounds,
            "probe_offset": settings.get("probe", {}),
        }

    async def preview(self, wizard: str, values: dict[str, Any]) -> dict[str, Any]:
        snapshot = await self.printer.snapshot()
        if not snapshot.connected or snapshot.state != "ready":
            raise WizardError("Klipper muss für die Einrichtung bereit sein")
        if snapshot.print_state in {"printing", "paused"}:
            raise WizardError("Die Konfiguration kann während eines Drucks nicht geändert werden")
        normalized = self._normalize(wizard, values)
        token = secrets.token_urlsafe(24)
        digest = self._digest(normalized)
        fingerprint = self.config.fingerprint() if self.config else "disabled"
        self._previews[wizard] = (token, normalized, fingerprint)
        return {
            "wizard": wizard,
            "section": self._schema(wizard)["section"],
            "settings": normalized,
            "confirmation_token": token,
            "digest": digest,
        }

    async def save(
        self, wizard: str, values: dict[str, Any], token: str, restart: bool
    ) -> dict[str, Any]:
        if not self.config:
            raise WizardError("Dauerhafte Konfigurationsänderungen sind deaktiviert")
        normalized = self._normalize(wizard, values)
        preview = self._previews.get(wizard)
        if not preview or not secrets.compare_digest(token, preview[0]) or normalized != preview[1]:
            raise WizardError("Die Einrichtungs-Vorschau ist ungültig oder wurde verändert")
        try:
            source, backup = self.config.update_section_settings(
                self._schema(wizard)["section"],
                normalized,
                preview[2],
                (r"screw\d+(?:_name)?",) if self._schema(wizard)["kind"] == "named_points" else (),
            )
        except ConfigError as exc:
            raise WizardError(str(exc)) from exc
        self._previews.pop(wizard, None)
        if restart:
            await self.printer.restart()
        return {
            "wizard": wizard,
            "source": str(source),
            "backup": str(backup),
            "restarted": restart,
        }

    @staticmethod
    def _schema(wizard: str) -> dict[str, Any]:
        schema = SETUP_SCHEMAS.get(wizard)
        if not schema:
            raise WizardError("Für diese Kalibrierung gibt es keinen Einrichtungsassistenten")
        return schema

    def _normalize(self, wizard: str, values: dict[str, Any]) -> dict[str, str]:
        schema = self._schema(wizard)
        if schema["kind"] == "mesh":
            minimum = self._point(values.get("mesh_min"), "Mesh-Minimum")
            maximum = self._point(values.get("mesh_max"), "Mesh-Maximum")
            if minimum[0] >= maximum[0] or minimum[1] >= maximum[1]:
                raise WizardError("Mesh-Maximum muss rechts oberhalb des Minimums liegen")
            count = self._integer_point(values.get("probe_count"), "Probe-Anzahl", 2, 50)
            result = {
                "mesh_min": self._format_point(minimum),
                "mesh_max": self._format_point(maximum),
                "probe_count": f"{count[0]}, {count[1]}",
            }
        elif schema["kind"] == "named_points":
            points = self._points(
                values.get("points"), schema["min_points"], schema["max_points"], named=True
            )
            result = {}
            for index, point in enumerate(points, start=1):
                result[f"screw{index}"] = self._format_point(point[:2])
                name = str(point[2] or f"Screw {index}")[:40]
                if any(character in name for character in "[]#;\n\r"):
                    raise WizardError(f"Name von Schraube {index} enthält ungültige Zeichen")
                result[f"screw{index}_name"] = name
            if "screw_thread" in schema["fields"]:
                thread = str(values.get("screw_thread", "CW-M4")).upper()
                if thread not in {
                    "CW-M3",
                    "CW-M4",
                    "CW-M5",
                    "CCW-M3",
                    "CCW-M4",
                    "CCW-M5",
                }:
                    raise WizardError("Ungültiges Schraubengewinde")
                result["screw_thread"] = thread
        elif schema["kind"] == "dual_points":
            positions = self._points(
                values.get("z_positions"), schema["min_points"], schema["max_points"]
            )
            points = self._points(values.get("points"), schema["min_points"], schema["max_points"])
            result = {
                "z_positions": "\n".join(self._format_point(item[:2]) for item in positions),
                "points": "\n".join(self._format_point(item[:2]) for item in points),
            }
        else:
            corners = self._points(values.get("gantry_corners"), 2, 2)
            points = self._points(values.get("points"), 4, 4)
            result = {
                "gantry_corners": "\n".join(self._format_point(item[:2]) for item in corners),
                "points": "\n".join(self._format_point(item[:2]) for item in points),
            }
        numeric_limits = {
            "speed": (1, 1000),
            "horizontal_move_z": (0.1, 100),
            "retries": (0, 20),
            "retry_tolerance": (0.001, 5),
            "max_adjust": (0.1, 50),
            "probe_height": (0.1, 50),
        }
        for key, (minimum, maximum) in numeric_limits.items():
            if key in schema["fields"] and values.get(key) not in {None, ""}:
                number = self._number(values[key], key, minimum, maximum)
                result[key] = f"{number:g}"
        return result

    def _points(
        self, value: Any, minimum: int, maximum: int, *, named: bool = False
    ) -> list[tuple[float, float] | tuple[float, float, str]]:
        if not isinstance(value, list) or not minimum <= len(value) <= maximum:
            raise WizardError(f"Es werden {minimum} bis {maximum} Punkte benötigt")
        result = []
        for index, item in enumerate(value, start=1):
            if not isinstance(item, dict):
                raise WizardError(f"Punkt {index} ist ungültig")
            point = self._point([item.get("x"), item.get("y")], f"Punkt {index}")
            result.append((*point, str(item.get("name", ""))) if named else point)
        return result

    def _point(self, value: Any, label: str) -> tuple[float, float]:
        if isinstance(value, str):
            value = value.split(",")
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            raise WizardError(f"{label} benötigt X und Y")
        return (
            self._number(value[0], f"{label} X", -1000, 1000),
            self._number(value[1], f"{label} Y", -1000, 1000),
        )

    def _integer_point(self, value: Any, label: str, minimum: int, maximum: int) -> tuple[int, int]:
        point = self._point(value, label)
        if any(not number.is_integer() for number in point):
            raise WizardError(f"{label} muss ganzzahlig sein")
        integers = int(point[0]), int(point[1])
        if any(number < minimum or number > maximum for number in integers):
            raise WizardError(f"{label} muss zwischen {minimum} und {maximum} liegen")
        return integers

    @staticmethod
    def _number(value: Any, label: str, minimum: float, maximum: float) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise WizardError(f"{label} ist keine gültige Zahl") from exc
        if not math.isfinite(number) or number < minimum or number > maximum:
            raise WizardError(f"{label} muss zwischen {minimum:g} und {maximum:g} liegen")
        return number

    @staticmethod
    def _format_point(point: tuple[float, float]) -> str:
        return f"{point[0]:g}, {point[1]:g}"

    @staticmethod
    def _digest(settings: dict[str, str]) -> str:
        payload = json.dumps(settings, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode()).hexdigest()[:12]
