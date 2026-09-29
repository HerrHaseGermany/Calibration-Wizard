import math

import pytest
from calibration_wizard.calculation import ValidationError, calculate_rotation_distance


def test_documented_rotation_distance_example():
    result = calculate_rotation_distance(4.706, 120, 100, 24)

    assert result.actual_extrusion == 96
    assert math.isclose(result.new_rotation_distance, 4.51776, rel_tol=1e-9)
    assert result.deviation_mm == -4
    assert result.deviation_percent == -4
    assert result.safe_to_apply


@pytest.mark.parametrize("remaining", [-1, 120, 121, float("nan"), float("inf")])
def test_invalid_remaining_distance_is_rejected(remaining):
    with pytest.raises(ValidationError):
        calculate_rotation_distance(4.706, 120, 100, remaining)


def test_large_deviation_requires_remeasurement():
    result = calculate_rotation_distance(4.706, 120, 100, 50)

    assert not result.safe_to_apply
    assert result.warnings
