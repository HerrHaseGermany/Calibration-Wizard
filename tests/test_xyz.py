from pathlib import Path

import pytest
from calibration_wizard.advanced import CalibrationManager
from calibration_wizard.api import create_app
from calibration_wizard.printer import MockPrinter, PrinterError
from calibration_wizard.settings import Settings
from calibration_wizard.wizard import WizardError
from calibration_wizard.xyz import XyzTravelCheck
from fastapi.testclient import TestClient


async def prepared(axis="x", direction=1, distance=10):
    printer = MockPrinter()
    manager = CalibrationManager(printer)
    await manager.start("xyz", {})
    await manager.action("xyz", "home", {}, None)
    await manager.action("xyz", "prepare", {
        "axis": axis, "direction": direction, "distance": distance, "speed": 2,
    }, None)
    return printer, manager


@pytest.mark.asyncio
async def test_xyz_measures_repeats_and_restores_modes_without_changing_config():
    printer, manager = await prepared()
    for index, actual in enumerate((10.1, 10.2, 10.0)):
        await manager.action("xyz", "move", {}, None)
        assert printer.position[0] == 30
        await manager.action("xyz", "measure", {"actual": actual}, None)
        if index < 2:
            with pytest.raises(WizardError):
                await manager.action("xyz", "finish", {}, None)
            await manager.action("xyz", "return", {}, None)
            assert printer.position[0] == 20
    result = await manager.action("xyz", "finish", {}, None)
    assert result.state == "COMPLETE"
    row = result.data["results"][0]
    assert row["count"] == 3
    assert row["average_error"] == pytest.approx(0.1)
    assert row["average_percent"] == pytest.approx(1)
    assert row["error_range"] == pytest.approx(0.2)
    assert printer.data.rotation_distance == 4.706
    assert all("RESTORE_GCODE_STATE NAME=kcw_xyz MOVE=0" in code
               for code in printer.gcodes if code != "G28")
    assert not any("SAVE_CONFIG" in code for code in printer.gcodes)


@pytest.mark.asyncio
@pytest.mark.parametrize("axis", ["x", "y", "z"])
async def test_xyz_negative_motion_moves_only_selected_axis(axis):
    printer, manager = await prepared(axis=axis, direction=-1, distance=3)
    origin = printer.position.copy()
    await manager.action("xyz", "move", {}, None)
    expected = origin.copy()
    expected["xyz".index(axis)] -= 3
    assert printer.position == expected
    await manager.action("xyz", "measure", {"actual": 3.01}, None)
    await manager.action("xyz", "return", {}, None)
    assert printer.position == origin


@pytest.mark.asyncio
@pytest.mark.parametrize("values", [
    {"axis": "e"}, {"distance": float("nan")}, {"distance": 0},
    {"distance": 101}, {"speed": 11}, {"axis": "z", "speed": 3},
    {"direction": 0}, {"direction": -1, "distance": 30},
])
async def test_xyz_invalid_or_out_of_bounds_plans_never_move(values):
    printer = MockPrinter()
    manager = CalibrationManager(printer)
    await manager.start("xyz", {})
    await manager.action("xyz", "home", {}, None)
    with pytest.raises(WizardError):
        await manager.action("xyz", "prepare", {
            "axis": "x", "distance": 10, "speed": 2, **values,
        }, None)
    assert printer.gcodes == ["G28"]


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["printing", "paused"])
async def test_xyz_printing_and_pause_block_start_and_movement(state):
    printer, manager = await prepared()
    printer.data.print_state = state
    with pytest.raises(WizardError):
        await manager.action("xyz", "move", {}, None)
    assert printer.gcodes == ["G28"]
    other = CalibrationManager(printer)
    with pytest.raises(WizardError):
        await other.start("xyz", {})


@pytest.mark.asyncio
async def test_xyz_position_changes_or_lost_homing_block_motion():
    printer, manager = await prepared()
    printer.position[1] += 1
    with pytest.raises(WizardError) as error:
        await manager.action("xyz", "move", {}, None)
    assert error.value.message_key == "xyz.errors.changed"
    printer.data.homed_axes = "xy"
    with pytest.raises(WizardError) as error:
        await manager.action("xyz", "move", {}, None)
    assert error.value.message_key == "xyz.errors.homing"
    assert printer.gcodes == ["G28"]


@pytest.mark.asyncio
async def test_xyz_cancel_does_not_move_and_prevents_overlapping_sessions():
    printer, manager = await prepared()
    with pytest.raises(WizardError):
        await manager.start("xyz", {})
    with pytest.raises(WizardError):
        await manager.start("bed_mesh", {})
    await manager.action("xyz", "cancel", {}, None)
    assert printer.gcodes == ["G28"]
    await manager.start("bed_mesh", {})


@pytest.mark.asyncio
async def test_xyz_motion_failure_is_not_recorded_as_success():
    printer, manager = await prepared()

    async def fail(*args, **kwargs):
        raise PrinterError("Motion failed")

    printer.run_gcode = fail
    with pytest.raises(WizardError):
        await manager.action("xyz", "move", {}, None)
    assert manager.sessions["xyz"].state == "ERROR"
    assert manager.sessions["xyz"].data["samples"] == []


def test_xyz_registered_and_assets_served():
    root = Path(__file__).resolve().parents[1]
    app = create_app(Settings.from_env(), MockPrinter())
    with TestClient(app) as client:
        definitions = client.get("/api/wizards").json()
        assert next(row for row in definitions if row["id"] == "xyz")["available"]
        assert client.get("/assets/wizards/xyz/frontend.mjs").status_code == 200
        cube = client.get("/assets/wizards/xyz/xyzCalibration_cube.stl")
        assert cube.status_code == 200
        assert cube.content == (root / "wizards/xyz/xyzCalibration_cube.stl").read_bytes()


def test_xyz_results_keep_distances_and_directions_in_separate_series():
    rows = XyzTravelCheck.results([
        {"axis": "x", "requested": 10, "direction": 1, "actual": 10.1},
        {"axis": "x", "requested": 20, "direction": 1, "actual": 20.2},
        {"axis": "x", "requested": 10, "direction": -1, "actual": 10.3},
    ])
    assert len(rows) == 3
    assert all(row["count"] == 1 for row in rows)


@pytest.mark.asyncio
async def test_xyz_missing_position_data_and_low_z_clearance_fail_closed():
    printer, manager = await prepared()
    printer.position[2] = 4
    with pytest.raises(WizardError) as error:
        await manager.action("xyz", "move", {}, None)
    assert error.value.message_key == "xyz.errors.changed"
    await manager.action("xyz", "cancel", {}, None)
    await manager.start("xyz", {})
    await manager.action("xyz", "home", {}, None)
    with pytest.raises(WizardError) as error:
        await manager.action("xyz", "prepare", {"axis": "x", "distance": 10, "speed": 2}, None)
    assert error.value.message_key == "xyz.errors.clearance"

    async def missing(objects):
        return {"toolhead": {}}

    printer.query_objects = missing
    with pytest.raises(WizardError) as error:
        await manager.action("xyz", "prepare", {"axis": "x", "distance": 10, "speed": 2}, None)
    assert error.value.message_key == "xyz.errors.position"
    assert printer.gcodes == ["G28", "G28"]
