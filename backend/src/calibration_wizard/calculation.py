from __future__ import annotations

import math

from .models import CalibrationResult


class ValidationError(ValueError):
    """Raised when a measurement is invalid or physically meaningless."""


def calculate_rotation_distance(
    old_rotation_distance: float,
    mark_distance: float,
    commanded_extrusion: float,
    remaining_distance: float,
) -> CalibrationResult:
    values = {
        "old rotation distance": old_rotation_distance,
        "mark distance": mark_distance,
        "commanded extrusion": commanded_extrusion,
        "remaining distance": remaining_distance,
    }
    if any(not math.isfinite(value) for value in values.values()):
        raise ValidationError("All values must be finite numbers")
    if old_rotation_distance <= 0 or old_rotation_distance > 100:
        raise ValidationError("The current rotation_distance is outside the supported range")
    if mark_distance <= 0 or commanded_extrusion <= 0:
        raise ValidationError("Mark and extrusion distances must be positive")
    if remaining_distance < 0:
        raise ValidationError("Remaining distance cannot be negative")
    if remaining_distance >= mark_distance:
        raise ValidationError("Remaining distance must be smaller than the mark distance")

    actual = mark_distance - remaining_distance
    new_distance = old_rotation_distance * actual / commanded_extrusion
    deviation = actual - commanded_extrusion
    deviation_percent = deviation / commanded_extrusion * 100

    warnings: list[str] = []
    change_percent = abs(new_distance / old_rotation_distance - 1) * 100
    if actual <= 0 or new_distance <= 0 or new_distance > 100:
        warnings.append("The calculated rotation_distance is not realistic.")
    if abs(deviation_percent) > 20:
        warnings.append("The measured extrusion differs by more than 20% from the request.")
    elif abs(deviation_percent) > 10:
        warnings.append("The measured extrusion differs by more than 10%; remeasure carefully.")
    if change_percent > 20:
        warnings.append("The new rotation_distance changes the current value by more than 20%.")

    return CalibrationResult(
        requested_extrusion=commanded_extrusion,
        actual_extrusion=actual,
        deviation_mm=deviation,
        deviation_percent=deviation_percent,
        old_rotation_distance=old_rotation_distance,
        new_rotation_distance=new_distance,
        warnings=warnings,
        safe_to_apply=not warnings,
    )
