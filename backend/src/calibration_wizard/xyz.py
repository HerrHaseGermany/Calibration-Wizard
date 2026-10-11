"""Measured XYZ travel checks; never changes stepper configuration."""

from __future__ import annotations

import math
from typing import Any

from .models import CalibrationSession
from .printer import PrinterAdapter
from .wizard import WizardError


def number(value: Any) -> float:
    try:
        result = float(value)
    except (ValueError, TypeError) as exc:
        raise WizardError("Invalid number", message_key="ui.invalid_numeric_value") from exc
    if not math.isfinite(result):
        raise WizardError("Non-finite number", message_key="ui.the_numeric_value_must_be_finite")
    return result


class XyzTravelCheck:
    def __init__(self, printer: PrinterAdapter) -> None:
        self.printer = printer

    async def position(self) -> tuple[list[float], list[float], list[float]]:
        status = await self.printer.query_objects(
            {"toolhead": ["position", "axis_minimum", "axis_maximum"]}
        )
        toolhead = status.get("toolhead", {})
        try:
            vectors = [
                [number(toolhead[key][i]) for i in range(3)]
                for key in ("position", "axis_minimum", "axis_maximum")
            ]
        except (KeyError, IndexError, TypeError) as exc:
            raise WizardError("Missing axis limits", message_key="xyz.errors.position") from exc
        return vectors[0], vectors[1], vectors[2]

    @staticmethod
    def bounds(point: list[float], low: list[float], high: list[float]) -> None:
        if any(not low[i] + 2 <= point[i] <= high[i] - 2 for i in range(3)):
            raise WizardError("Travel outside safe bounds", message_key="xyz.errors.bounds")
        if point[2] < 5:
            raise WizardError("Insufficient Z clearance", message_key="xyz.errors.clearance")

    async def action(
        self, session: CalibrationSession, action: str, values: dict[str, Any]
    ) -> None:
        data = session.data
        if action == "prepare":
            self.require(session, "HOMED", "REVIEW")
            axis = str(values.get("axis", "")).lower()
            if axis not in {"x", "y", "z"}:
                raise WizardError("Invalid axis", message_key="xyz.errors.axis")
            distance = number(values.get("distance"))
            speed = number(values.get("speed"))
            direction = number(values.get("direction", 1))
            if not 1 <= distance <= 100 or not 0 < speed <= (2 if axis == "z" else 10):
                raise WizardError("Invalid travel settings", message_key="xyz.errors.settings")
            if direction not in {-1, 1}:
                raise WizardError("Invalid direction", message_key="xyz.errors.settings")
            position, low, high = await self.position()
            destination = position.copy()
            destination["xyz".index(axis)] += distance * direction
            self.bounds(position, low, high)
            self.bounds(destination, low, high)
            data.update(axis=axis, distance=distance, speed=speed, direction=direction,
                        origin=position, destination=destination)
            session.state = "AT_START"
        elif action in {"move", "return"}:
            self.require(session, "AT_START" if action == "move" else "REVIEW")
            position, low, high = await self.position()
            expected = data["origin"] if action == "move" else data["destination"]
            destination = data["destination"] if action == "move" else data["origin"]
            if any(abs(position[i] - expected[i]) > 0.05 for i in range(3)):
                raise WizardError("Position changed", message_key="xyz.errors.changed")
            self.bounds(position, low, high)
            self.bounds(destination, low, high)
            axis = data["axis"].upper()
            distance = data["distance"] * data["direction"] * (1 if action == "move" else -1)
            session.state = "RUNNING"
            # MOVE=0 restores coordinate/feed modes without another physical move.
            await self.printer.run_gcode(
                "SAVE_GCODE_STATE NAME=kcw_xyz\nG91\n"
                f"G1 {axis}{distance:.6f} F{data['speed'] * 60:.3f}\nM400\n"
                "RESTORE_GCODE_STATE NAME=kcw_xyz MOVE=0",
                long_running=True,
            )
            session.state = "WAITING_MEASUREMENT" if action == "move" else "AT_START"
        elif action == "measure":
            self.require(session, "WAITING_MEASUREMENT")
            actual = number(values.get("actual"))
            if not 0 < actual <= 200:
                raise WizardError("Invalid measured travel", message_key="xyz.errors.measurement")
            samples = data.setdefault("samples", [])
            samples.append({"axis": data["axis"], "requested": data["distance"],
                            "actual": actual, "direction": data["direction"]})
            data["results"] = self.results(samples)
            session.state = "REVIEW"
        elif action == "finish":
            self.require(session, "REVIEW")
            if any(row["count"] < 3 for row in data["results"]):
                raise WizardError("Repeat each axis three times", message_key="xyz.errors.repeats")
            session.state = "COMPLETE"
        else:
            raise WizardError("Unknown action", message_key="ui.unknown_calibration_or_action")

    @staticmethod
    def require(session: CalibrationSession, *states: str) -> None:
        if session.state not in states:
            raise WizardError("Invalid measurement step", message_key="xyz.errors.step")

    @staticmethod
    def results(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
        result = []
        groups = sorted({(row["axis"], row["requested"], row["direction"]) for row in samples})
        for axis, requested, direction in groups:
            rows = [row for row in samples if
                    (row["axis"], row["requested"], row["direction"]) ==
                    (axis, requested, direction)]
            errors = [row["actual"] - row["requested"] for row in rows]
            result.append({
                "axis": axis, "count": len(rows), "requested": requested,
                "direction": direction,
                "average_error": sum(errors) / len(errors),
                "average_percent": sum(
                    error / row["requested"] * 100 for error, row in zip(errors, rows)
                ) / len(rows),
                "error_range": max(errors) - min(errors),
            })
        return result
