from pathlib import Path

import pytest
from calibration_wizard.advanced import CalibrationManager, availability
from calibration_wizard.api import create_app
from calibration_wizard.configuration import KlipperConfigRepository
from calibration_wizard.models import PrinterCapabilities
from calibration_wizard.printer import MockPrinter
from calibration_wizard.settings import Settings
from calibration_wizard.setup import CalibrationSetupManager
from calibration_wizard.wizard import WizardError
from fastapi.testclient import TestClient


def test_input_shaper_is_disabled_until_sensor_commands_exist():
    caps = PrinterCapabilities(settings=["input_shaper"])

    available, reason = availability("input_shaper", caps)

    assert available is False
    assert "Resonanzsensor" in reason


def test_input_shaper_activates_automatically_with_complete_configuration():
    caps = PrinterCapabilities(
        commands=["SHAPER_CALIBRATE", "ACCELEROMETER_QUERY"],
        settings=["input_shaper", "resonance_tester"],
    )

    assert availability("input_shaper", caps) == (True, None)


@pytest.mark.asyncio
async def test_flow_calculation_uses_average_measurement():
    manager = CalibrationManager(MockPrinter())
    await manager.start("flow", {})

    result = await manager.action(
        "flow",
        "calculate",
        {"expected": 0.4, "current": 100, "measurements": [0.42, 0.4, 0.41, 0.41]},
        None,
    )

    assert result.state == "COMPLETE"
    assert result.data["average"] == pytest.approx(0.41)
    assert result.data["result"] == pytest.approx(97.5609756)


@pytest.mark.asyncio
async def test_hardware_workflow_steps_cannot_be_skipped():
    manager = CalibrationManager(MockPrinter())
    await manager.start("bed_mesh", {})

    with pytest.raises(WizardError, match="Zustand READY"):
        await manager.action("bed_mesh", "run", {}, None)


@pytest.mark.asyncio
async def test_motion_calibration_is_blocked_during_print():
    printer = MockPrinter()
    printer.data.print_state = "printing"
    manager = CalibrationManager(printer)

    with pytest.raises(WizardError, match="Drucks"):
        await manager.start("bed_mesh", {})


@pytest.mark.asyncio
async def test_pressure_advance_restores_velocity_limits_when_applied():
    printer = MockPrinter()
    manager = CalibrationManager(printer)
    await manager.start("pressure_advance", {"drive": "direct"})
    await manager.action("pressure_advance", "prepare", {}, None)
    await manager.action("pressure_advance", "calculate", {"height": 10}, None)

    await manager.action("pressure_advance", "apply", {}, None)

    assert "SET_PRESSURE_ADVANCE ADVANCE=0.050000" in printer.gcodes[-1]
    assert "ACCEL=3000" in printer.gcodes[-1]
    assert "SQUARE_CORNER_VELOCITY=5" in printer.gcodes[-1]


def test_extruder_specific_start_route_wins_over_generic_route(tmp_path: Path):
    settings = Settings(
        host="127.0.0.1",
        port=7130,
        mock=True,
        moonraker_url="http://127.0.0.1:7125",
        moonraker_api_key=None,
        klipper_config=None,
        backup_dir=tmp_path / "backups",
        frontend_dir=tmp_path,
    )
    client = TestClient(create_app(settings, MockPrinter()))

    response = client.post(
        "/api/wizards/extruder/start",
        json={"mark_distance": 120, "commanded_extrusion": 100},
    )

    assert response.status_code == 200
    assert response.json()["extruder"] == "extruder"


def test_status_exposes_hotend_and_bed_temperatures(tmp_path: Path):
    settings = Settings(
        host="127.0.0.1",
        port=7130,
        mock=True,
        moonraker_url="http://127.0.0.1:7125",
        moonraker_api_key=None,
        klipper_config=None,
        backup_dir=tmp_path / "backups",
        frontend_dir=tmp_path,
    )
    printer = MockPrinter()
    printer.data.temperature = 211.5
    printer.data.bed_temperature = 59.7
    client = TestClient(create_app(settings, printer))

    response = client.get("/api/status")

    assert response.status_code == 200
    assert response.json()["printer"]["temperature"] == 211.5
    assert response.json()["printer"]["bed_temperature"] == 59.7


def test_flow_calibration_model_is_downloadable(tmp_path: Path):
    frontend = Path(__file__).resolve().parents[1] / "frontend"
    settings = Settings(
        host="127.0.0.1",
        port=7130,
        mock=True,
        moonraker_url="http://127.0.0.1:7125",
        moonraker_api_key=None,
        klipper_config=None,
        backup_dir=tmp_path / "backups",
        frontend_dir=frontend,
    )
    client = TestClient(create_app(settings, MockPrinter()))

    response = client.get("/assets/models/flow-calibration-cube-30x30x20.stl")

    assert response.status_code == 200
    assert response.text.startswith("solid flow_calibration_cube_30x30x20")
    assert response.text.count("facet normal") == 12


def test_emergency_stop_uses_immediate_printer_endpoint(tmp_path: Path):
    settings = Settings(
        host="127.0.0.1",
        port=7130,
        mock=True,
        moonraker_url="http://127.0.0.1:7125",
        moonraker_api_key=None,
        klipper_config=None,
        backup_dir=tmp_path / "backups",
        frontend_dir=tmp_path,
    )
    printer = MockPrinter()
    printer.data.target = 220
    printer.data.bed_target = 60
    client = TestClient(create_app(settings, printer))

    response = client.post("/api/emergency-stop")

    assert response.status_code == 200
    assert response.json() == {"status": "shutdown"}
    assert printer.data.state == "shutdown"
    assert printer.data.target == 0
    assert printer.data.bed_target == 0


def test_pressure_advance_can_be_inserted_with_backup(tmp_path: Path):
    config = tmp_path / "printer.cfg"
    config.write_text("[extruder]\nrotation_distance: 4.5\n", encoding="utf-8")
    repository = KlipperConfigRepository(config, tmp_path / "backups")

    source, backup = repository.upsert_numeric("extruder", "pressure_advance", 0.0475)

    assert source == config.resolve()
    assert "pressure_advance: 0.04750000" in config.read_text(encoding="utf-8")
    assert "pressure_advance" not in backup.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_setup_accepts_six_screws_and_saves_normalized_section(tmp_path: Path):
    config = tmp_path / "printer.cfg"
    config.write_text("[printer]\nkinematics: corexy\n", encoding="utf-8")
    repository = KlipperConfigRepository(config, tmp_path / "backups")
    printer = MockPrinter()
    manager = CalibrationSetupManager(printer, repository)
    values = {
        "points": [
            {"x": index * 20, "y": (index % 2) * 100, "name": f"Screw {index + 1}"}
            for index in range(6)
        ],
        "screw_thread": "CW-M4",
        "speed": 100,
    }

    preview = await manager.preview("screws_tilt", values)
    result = await manager.save("screws_tilt", values, preview["confirmation_token"], restart=False)

    updated = config.read_text(encoding="utf-8")
    assert result["restarted"] is False
    assert "[screws_tilt_adjust]" in updated
    assert "screw6: 100, 100" in updated


@pytest.mark.asyncio
async def test_quad_gantry_requires_exactly_four_probe_points(tmp_path: Path):
    config = tmp_path / "printer.cfg"
    config.write_text("[printer]\nkinematics: corexy\n", encoding="utf-8")
    manager = CalibrationSetupManager(
        MockPrinter(), KlipperConfigRepository(config, tmp_path / "backups")
    )

    with pytest.raises(WizardError, match="4 bis 4"):
        await manager.preview(
            "quad_gantry_level",
            {
                "gantry_corners": [{"x": 0, "y": 0}, {"x": 300, "y": 300}],
                "points": [{"x": 20, "y": 20}] * 3,
            },
        )
