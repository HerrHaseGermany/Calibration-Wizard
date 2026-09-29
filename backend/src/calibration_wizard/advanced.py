from __future__ import annotations

import asyncio
import math
import secrets
from typing import Any

from .configuration import ConfigError, KlipperConfigRepository
from .models import CalibrationSession, PrinterCapabilities, PrinterSnapshot
from .printer import PrinterAdapter, PrinterError
from .wizard import WizardError

CAPABILITY_REQUIREMENTS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "pid": (("PID_CALIBRATE",), ()),
    "bed_mesh": (("BED_MESH_CALIBRATE",), ("bed_mesh",)),
    "screws_tilt": (("SCREWS_TILT_CALCULATE",), ("screws_tilt_adjust",)),
    "bed_screws": (("BED_SCREWS_ADJUST",), ("bed_screws",)),
    "z_tilt": (("Z_TILT_ADJUST",), ("z_tilt",)),
    "quad_gantry_level": (("QUAD_GANTRY_LEVEL",), ("quad_gantry_level",)),
    "probe_offset": (("PROBE_CALIBRATE",), ("probe",)),
    "pressure_advance": (("SET_PRESSURE_ADVANCE", "TUNING_TOWER"), ()),
    "flow": ((), ()),
    "input_shaper": (("SHAPER_CALIBRATE", "MEASURE_AXES_NOISE"), ("resonance_tester",)),
}


def availability(wizard: str, caps: PrinterCapabilities) -> tuple[bool, str | None]:
    commands, settings = CAPABILITY_REQUIREMENTS.get(wizard, ((), ()))
    missing_commands = [item for item in commands if not caps.has_command(item)]
    missing_settings = [item for item in settings if item not in caps.settings]
    if not missing_commands and not missing_settings:
        return True, None
    if wizard == "input_shaper":
        return False, (
            "Kein Resonanzsensor konfiguriert. Schließe einen Beschleunigungssensor an und "
            "konfiguriere [resonance_tester]; danach wird dieser Ablauf automatisch aktiviert."
        )
    missing = missing_commands + [f"[{item}]" for item in missing_settings]
    return False, "In Klipper fehlt: " + ", ".join(missing)


class CalibrationManager:
    def __init__(
        self, printer: PrinterAdapter, config: KlipperConfigRepository | None = None
    ) -> None:
        self.printer = printer
        self.config = config
        self.sessions: dict[str, CalibrationSession] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._start_lock = asyncio.Lock()

    async def definitions(self, definitions: tuple[Any, ...]) -> list[dict[str, Any]]:
        caps = await self.printer.capabilities()
        status = await self.printer.query_objects({"configfile": ["settings"]})
        settings = status.get("configfile", {}).get("settings", {})
        result = []
        for definition in definitions:
            available, reason = availability(definition.id, caps)
            data = {
                "id": definition.id,
                "name": definition.name,
                "description": definition.description,
                "available": available if definition.id != "extruder" else True,
                "required_features": definition.required_features,
                "availability_reason": reason,
                "setup_available": definition.id
                in {
                    "bed_mesh",
                    "screws_tilt",
                    "bed_screws",
                    "z_tilt",
                    "quad_gantry_level",
                },
                "configuration": self._configuration_summary(definition.id, settings),
            }
            if definition.id == "pid":
                data["configuration"]["heaters"] = caps.heaters
            result.append(data)
        return result

    @staticmethod
    def _configuration_summary(wizard: str, settings: dict[str, Any]) -> dict[str, Any]:
        if wizard in {"screws_tilt", "bed_screws"}:
            section = settings.get(
                "screws_tilt_adjust" if wizard == "screws_tilt" else "bed_screws", {}
            )
            return {
                "point_count": sum(
                    1 for key in section if key.startswith("screw") and key[5:].isdigit()
                )
            }
        section_name = {
            "bed_mesh": "bed_mesh",
            "z_tilt": "z_tilt",
            "quad_gantry_level": "quad_gantry_level",
        }.get(wizard)
        section = settings.get(section_name, {}) if section_name else {}
        points = section.get("points") or section.get("probe_count") or []
        return {"points": points}

    async def _safe(self, wizard: str, *, require_clean: bool = False) -> PrinterSnapshot:
        snapshot = await self.printer.snapshot()
        if not snapshot.connected or snapshot.state != "ready":
            raise WizardError("Klipper muss verbunden und bereit sein")
        if snapshot.print_state in {"printing", "paused"}:
            raise WizardError("Während eines Drucks oder einer Pause ist die Aktion gesperrt")
        caps = await self.printer.capabilities()
        available, reason = availability(wizard, caps)
        if not available:
            raise WizardError(reason or "Kalibrierung ist nicht verfügbar")
        if require_clean and snapshot.save_config_pending:
            raise WizardError(
                "Klipper hat bereits ungespeicherte SAVE_CONFIG-Werte. Speichere oder verwerfe "
                "diese zuerst, damit die Kalibrierung keine fremden Änderungen übernimmt."
            )
        return snapshot

    def _session(self, wizard: str) -> CalibrationSession:
        session = self.sessions.get(wizard)
        if not session:
            raise WizardError("Für diese Kalibrierung ist keine Sitzung aktiv")
        return session

    async def start(self, wizard: str, options: dict[str, Any]) -> CalibrationSession:
        async with self._start_lock:
            return await self._start(wizard, options)

    async def _start(self, wizard: str, options: dict[str, Any]) -> CalibrationSession:
        if wizard not in CAPABILITY_REQUIREMENTS:
            raise WizardError("Unbekannte Kalibrierung")
        if wizard == "flow":
            snapshot = await self.printer.snapshot()
        else:
            snapshot = await self._safe(
                wizard,
                require_clean=wizard in {"pid", "bed_mesh", "probe_offset", "input_shaper"},
            )
        data: dict[str, Any] = dict(options)
        if wizard == "pid":
            caps = await self.printer.capabilities()
            heater = str(options.get("heater", "extruder"))
            if heater not in caps.heaters:
                raise WizardError("Der gewählte Heizer ist nicht konfiguriert")
            target = self._number(options.get("target", 220 if heater == "extruder" else 60))
            is_extruder = heater.startswith("extruder")
            maximum = 300 if is_extruder else 130
            minimum = 150 if is_extruder else 30
            if target < minimum or target > maximum or target % 5:
                raise WizardError(
                    f"Zieltemperatur muss in 5-°C-Schritten zwischen {minimum} und {maximum} liegen"
                )
            data = {"heater": heater, "target": target}
        elif wizard == "pressure_advance":
            style = str(options.get("drive", "direct"))
            if style not in {"direct", "bowden"}:
                raise WizardError("Extruder-Typ muss Direct Drive oder Bowden sein")
            factor = 0.005 if style == "direct" else 0.020
            status = await self.printer.query_objects(
                {
                    "toolhead": ["max_accel", "square_corner_velocity"],
                    "configfile": ["settings"],
                }
            )
            limits = status.get("toolhead", {})
            extruder_settings = (
                status.get("configfile", {}).get("settings", {}).get(snapshot.extruder, {})
            )
            data = {
                "drive": style,
                "start": 0.0,
                "factor": factor,
                "extruder": snapshot.extruder,
                "original_pressure_advance": extruder_settings.get("pressure_advance", 0.0),
                "model_url": "https://www.klipper3d.org/prints/square_tower.stl",
                "original_max_accel": limits.get("max_accel"),
                "original_square_corner_velocity": limits.get("square_corner_velocity"),
            }
        elif wizard == "input_shaper":
            axis = str(options.get("axis", "both")).lower()
            if axis not in {"x", "y", "both"}:
                raise WizardError("Achse muss X, Y oder beide sein")
            data = {"axis": axis}
        elif wizard == "flow":
            data = {}
        data["printer"] = snapshot.model_dump(mode="json")
        session = CalibrationSession(
            id=secrets.token_urlsafe(16), wizard=wizard, state="READY", data=data
        )
        self.sessions[wizard] = session
        self._locks[wizard] = asyncio.Lock()
        return session

    async def action(
        self,
        wizard: str,
        action: str,
        values: dict[str, Any],
        confirmation_token: str | None,
    ) -> CalibrationSession:
        lock = self._locks.get(wizard)
        if lock is None:
            raise WizardError("Für diese Kalibrierung ist keine Sitzung aktiv")
        async with lock:
            session = self._session(wizard)
            try:
                if action == "cancel":
                    await self._cancel(session)
                elif action == "home":
                    required = "SENSOR_READY" if wizard == "input_shaper" else "READY"
                    self._require_state(session, required)
                    await self._safe(wizard)
                    session.state = "HOMING"
                    await self.printer.run_gcode("G28", long_running=True)
                    session.state = "HOMED"
                elif wizard == "pid":
                    await self._pid(session, action, confirmation_token)
                elif wizard == "bed_mesh":
                    await self._bed_mesh(session, action, confirmation_token)
                elif wizard == "screws_tilt":
                    await self._screws(session, action)
                elif wizard == "bed_screws":
                    await self._bed_screws(session, action)
                elif wizard in {"z_tilt", "quad_gantry_level"}:
                    await self._gantry(session, action)
                elif wizard == "probe_offset":
                    await self._probe(session, action, values, confirmation_token)
                elif wizard == "pressure_advance":
                    await self._pressure_advance(session, action, values, confirmation_token)
                elif wizard == "flow":
                    self._flow(session, action, values)
                elif wizard == "input_shaper":
                    await self._input_shaper(session, action, confirmation_token)
                else:
                    raise WizardError("Unbekannte Kalibrierung oder Aktion")
            except (PrinterError, ConfigError) as exc:
                session.state = "ERROR"
                session.error = str(exc)
                raise WizardError(str(exc)) from exc
        return session

    async def _cancel(self, session: CalibrationSession) -> None:
        if session.state in {"COMPLETE", "CANCELLED"}:
            raise WizardError("Diese Kalibrierung ist bereits beendet")
        if session.wizard == "pressure_advance" and session.state in {
            "PRINT_TOWER",
            "CALCULATED",
            "APPLIED",
        }:
            snapshot = await self.printer.snapshot()
            if snapshot.print_state in {"printing", "paused"}:
                raise WizardError(
                    "Beende oder brich den Testdruck in Mainsail ab, bevor du die "
                    "Pressure-Advance-Kalibrierung verlässt."
                )
            await self._restore_pressure_advance_test(session)
        if session.wizard in {"probe_offset", "bed_screws"} and session.state == "ADJUSTING":
            await self.printer.run_gcode("ABORT")
        session.save_token = None
        session.state = "CANCELLED"

    async def _pid(self, session: CalibrationSession, action: str, token: str | None) -> None:
        if action == "run":
            self._require_state(session, "READY")
            await self._safe("pid", require_clean=True)
            session.state = "RUNNING"
            await self.printer.run_gcode(
                f"PID_CALIBRATE HEATER={session.data['heater']} "
                f"TARGET={session.data['target']:.0f}",
                long_running=True,
            )
            snapshot = await self.printer.snapshot()
            session.data["pending_items"] = snapshot.save_config_pending_items
            session.state = "REVIEW"
            session.save_token = secrets.token_urlsafe(24)
        elif action == "save":
            self._require_state(session, "REVIEW")
            await self._save_config(session, token)
        else:
            raise WizardError("Diese PID-Aktion ist nicht erlaubt")

    async def _bed_mesh(self, session: CalibrationSession, action: str, token: str | None) -> None:
        if action == "run":
            self._require_state(session, "HOMED")
            snapshot = await self._safe("bed_mesh", require_clean=True)
            if not all(axis in snapshot.homed_axes.lower() for axis in "xyz"):
                raise WizardError("Vor dem Bed Mesh müssen alle Achsen referenziert werden")
            session.state = "RUNNING"
            await self.printer.run_gcode("BED_MESH_CALIBRATE PROFILE=default", long_running=True)
            status = await self.printer.query_objects(
                {"bed_mesh": ["profile_name", "probed_matrix", "mesh_min", "mesh_max"]}
            )
            session.data["result"] = status.get("bed_mesh", {})
            snapshot = await self.printer.snapshot()
            session.data["pending_items"] = snapshot.save_config_pending_items
            session.state = "REVIEW"
            session.save_token = secrets.token_urlsafe(24)
        elif action == "save":
            self._require_state(session, "REVIEW")
            await self._save_config(session, token)
        else:
            raise WizardError("Diese Bed-Mesh-Aktion ist nicht erlaubt")

    async def _screws(self, session: CalibrationSession, action: str) -> None:
        if action != "calculate":
            raise WizardError("Diese Schrauben-Aktion ist nicht erlaubt")
        self._require_state(session, "HOMED", "REVIEW")
        snapshot = await self._safe("screws_tilt")
        if not all(axis in snapshot.homed_axes.lower() for axis in "xyz"):
            raise WizardError("Vor SCREWS_TILT_CALCULATE müssen alle Achsen referenziert werden")
        session.state = "RUNNING"
        await self.printer.run_gcode("SCREWS_TILT_CALCULATE", long_running=True)
        status = await self.printer.query_objects(
            {"screws_tilt_adjust": ["error", "max_deviation", "results"]}
        )
        session.data["result"] = status.get("screws_tilt_adjust", {})
        session.state = "REVIEW"

    async def _gantry(self, session: CalibrationSession, action: str) -> None:
        if action != "run":
            raise WizardError("Diese Gantry-Aktion ist nicht erlaubt")
        self._require_state(session, "HOMED")
        snapshot = await self._safe(session.wizard)
        if not all(axis in snapshot.homed_axes.lower() for axis in "xyz"):
            raise WizardError("Vor der Gantry-Kalibrierung müssen alle Achsen referenziert werden")
        command = "Z_TILT_ADJUST" if session.wizard == "z_tilt" else "QUAD_GANTRY_LEVEL"
        session.state = "RUNNING"
        await self.printer.run_gcode(command, long_running=True)
        session.state = "COMPLETE"

    async def _bed_screws(self, session: CalibrationSession, action: str) -> None:
        await self._safe("bed_screws")
        if action == "run":
            self._require_state(session, "HOMED")
            await self.printer.run_gcode("BED_SCREWS_ADJUST", long_running=True)
            session.state = "ADJUSTING"
        elif action == "next":
            self._require_state(session, "ADJUSTING")
            await self.printer.run_gcode("ADJUSTED")
        elif action == "accept":
            self._require_state(session, "ADJUSTING")
            await self.printer.run_gcode("ACCEPT")
            session.state = "COMPLETE"
        elif action == "abort":
            self._require_state(session, "ADJUSTING")
            await self.printer.run_gcode("ABORT")
            session.state = "CANCELLED"
        else:
            raise WizardError("Diese Bed-Screws-Aktion ist nicht erlaubt")

    async def _probe(
        self,
        session: CalibrationSession,
        action: str,
        values: dict[str, Any],
        token: str | None,
    ) -> None:
        await self._safe("probe_offset")
        if action == "begin":
            self._require_state(session, "HOMED")
            snapshot = await self.printer.snapshot()
            if not all(axis in snapshot.homed_axes.lower() for axis in "xyz"):
                raise WizardError("Vor PROBE_CALIBRATE müssen alle Achsen referenziert werden")
            await self.printer.run_gcode("PROBE_CALIBRATE", long_running=True)
            session.state = "ADJUSTING"
        elif action == "testz":
            self._require_state(session, "ADJUSTING")
            amount = self._number(values.get("amount"))
            allowed = {-1.0, -0.5, -0.1, -0.05, -0.01, 0.01, 0.05, 0.1, 0.5, 1.0}
            if amount not in allowed:
                raise WizardError("Nicht erlaubte TESTZ-Schrittweite")
            await self.printer.run_gcode(f"TESTZ Z={amount:g}")
        elif action == "accept":
            self._require_state(session, "ADJUSTING")
            await self.printer.run_gcode("ACCEPT")
            snapshot = await self.printer.snapshot()
            session.data["pending_items"] = snapshot.save_config_pending_items
            session.state = "REVIEW"
            session.save_token = secrets.token_urlsafe(24)
        elif action == "abort":
            self._require_state(session, "ADJUSTING")
            await self.printer.run_gcode("ABORT")
            session.state = "CANCELLED"
        elif action == "save":
            self._require_state(session, "REVIEW")
            await self._save_config(session, token)
        else:
            raise WizardError("Diese Probe-Aktion ist nicht erlaubt")

    async def _pressure_advance(
        self,
        session: CalibrationSession,
        action: str,
        values: dict[str, Any],
        token: str | None,
    ) -> None:
        await self._safe("pressure_advance")
        if action == "prepare":
            self._require_state(session, "READY")
            factor = session.data["factor"]
            await self.printer.run_gcode(
                "SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=1 ACCEL=500\n"
                "TUNING_TOWER COMMAND=SET_PRESSURE_ADVANCE "
                f"PARAMETER=ADVANCE START=0 FACTOR={factor:g}"
            )
            session.state = "PRINT_TOWER"
        elif action == "calculate":
            self._require_state(session, "PRINT_TOWER")
            height = self._number(values.get("height"))
            if height < 0 or height > 100:
                raise WizardError("Messhöhe muss zwischen 0 und 100 mm liegen")
            value = session.data["start"] + height * session.data["factor"]
            if value < 0 or value > 2:
                raise WizardError("Berechneter Pressure-Advance-Wert ist unplausibel")
            session.data.update({"height": height, "value": value})
            session.state = "CALCULATED"
        elif action == "apply":
            self._require_state(session, "CALCULATED")
            value = self._number(session.data.get("value"))
            await self.printer.run_gcode(
                f"SET_PRESSURE_ADVANCE EXTRUDER={session.data['extruder']} "
                f"ADVANCE={value:.6f}\n" + self._velocity_restore_command(session)
            )
            session.state = "APPLIED"
            session.save_token = secrets.token_urlsafe(24)
        elif action == "save":
            self._require_state(session, "APPLIED")
            self._check_token(session, token)
            if not self.config:
                raise WizardError("Dauerhafte Konfigurationsänderungen sind deaktiviert")
            source, backup = self.config.upsert_numeric(
                str(session.data["extruder"]),
                "pressure_advance",
                self._number(session.data.get("value")),
            )
            session.data.update({"source": str(source), "backup": str(backup)})
            session.save_token = None
            session.state = "COMPLETE"
        else:
            raise WizardError("Diese Pressure-Advance-Aktion ist nicht erlaubt")

    async def _restore_pressure_advance_test(self, session: CalibrationSession) -> None:
        original = self._number(session.data.get("original_pressure_advance", 0.0))
        commands = [
            f"SET_PRESSURE_ADVANCE EXTRUDER={session.data['extruder']} ADVANCE={original:.6f}"
        ]
        velocity = self._velocity_restore_command(session)
        if velocity:
            commands.append(velocity)
        await self.printer.run_gcode("\n".join(commands))

    @staticmethod
    def _velocity_restore_command(session: CalibrationSession) -> str:
        accel = session.data.get("original_max_accel")
        corner = session.data.get("original_square_corner_velocity")
        parts = ["SET_VELOCITY_LIMIT"]
        if accel is not None:
            parts.append(f"ACCEL={float(accel):g}")
        if corner is not None:
            parts.append(f"SQUARE_CORNER_VELOCITY={float(corner):g}")
        return " ".join(parts) if len(parts) > 1 else ""

    def _flow(self, session: CalibrationSession, action: str, values: dict[str, Any]) -> None:
        if action != "calculate":
            raise WizardError("Diese Flow-Aktion ist nicht erlaubt")
        self._require_state(session, "READY")
        expected = self._number(values.get("expected"))
        current = self._number(values.get("current", 100))
        measurements = [self._number(value) for value in values.get("measurements", [])]
        if len(measurements) != 4:
            raise WizardError("Für die Flow-Berechnung sind genau vier Messwerte erforderlich")
        if expected <= 0 or any(item <= 0 for item in measurements):
            raise WizardError("Sollmaß und Messwerte müssen größer als null sein")
        average = sum(measurements) / len(measurements)
        result = current * expected / average
        if result < 70 or result > 130:
            raise WizardError("Das Ergebnis liegt außerhalb des sicheren Bereichs 70–130 %")
        session.data.update({"average": average, "result": result})
        session.state = "COMPLETE"

    async def _input_shaper(
        self, session: CalibrationSession, action: str, token: str | None
    ) -> None:
        if action == "check":
            self._require_state(session, "READY")
            await self._safe("input_shaper", require_clean=True)
            session.state = "CHECKING"
            await self.printer.run_gcode("MEASURE_AXES_NOISE")
            session.state = "SENSOR_READY"
        elif action == "run":
            self._require_state(session, "HOMED")
            snapshot = await self._safe("input_shaper", require_clean=True)
            if not all(axis in snapshot.homed_axes.lower() for axis in "xy"):
                raise WizardError("Vor der Resonanzmessung müssen X und Y referenziert werden")
            axis = session.data["axis"]
            command = (
                "SHAPER_CALIBRATE" if axis == "both" else f"SHAPER_CALIBRATE AXIS={axis.upper()}"
            )
            session.state = "RUNNING"
            await self.printer.run_gcode(command, long_running=True)
            snapshot = await self.printer.snapshot()
            session.data["pending_items"] = snapshot.save_config_pending_items
            session.state = "REVIEW"
            session.save_token = secrets.token_urlsafe(24)
        elif action == "save":
            self._require_state(session, "REVIEW")
            await self._save_config(session, token)
        else:
            raise WizardError("Diese Input-Shaper-Aktion ist nicht erlaubt")

    async def _save_config(self, session: CalibrationSession, token: str | None) -> None:
        self._check_token(session, token)
        await self._safe(session.wizard)
        await self.printer.run_gcode("SAVE_CONFIG", long_running=True)
        session.save_token = None
        session.state = "COMPLETE"

    @staticmethod
    def _check_token(session: CalibrationSession, token: str | None) -> None:
        if (
            not token
            or not session.save_token
            or not secrets.compare_digest(token, session.save_token)
        ):
            raise WizardError("Speicherbestätigung ist ungültig oder abgelaufen")

    @staticmethod
    def _require_state(session: CalibrationSession, *states: str) -> None:
        if session.state not in states:
            expected = ", ".join(states)
            raise WizardError(
                f"Aktion ist in Zustand {session.state} nicht erlaubt; erwartet: {expected}"
            )

    @staticmethod
    def _number(value: Any) -> float:
        try:
            result = float(value)
        except (TypeError, ValueError) as exc:
            raise WizardError("Ungültiger Zahlenwert") from exc
        if not math.isfinite(result):
            raise WizardError("Zahlenwert muss endlich sein")
        return result
