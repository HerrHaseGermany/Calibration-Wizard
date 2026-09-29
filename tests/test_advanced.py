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
        commands=["SHAPER_CALIBRATE", "MEASURE_AXES_NOISE"],
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

    assert "SET_PRESSURE_ADVANCE EXTRUDER=extruder ADVANCE=0.050000" in printer.gcodes[-1]
    assert "ACCEL=3000" in printer.gcodes[-1]
    assert "SQUARE_CORNER_VELOCITY=5" in printer.gcodes[-1]


@pytest.mark.asyncio
async def test_pid_workflow_runs_and_saves_only_after_confirmation():
    printer = MockPrinter()
    manager = CalibrationManager(printer)
    session = await manager.start("pid", {"heater": "heater_bed", "target": 60})

    result = await manager.action("pid", "run", {}, None)

    assert result.state == "REVIEW"
    assert printer.gcodes[-1] == "PID_CALIBRATE HEATER=heater_bed TARGET=60"
    saved = await manager.action("pid", "save", {}, session.save_token)
    assert saved.state == "COMPLETE"
    assert printer.gcodes[-1] == "SAVE_CONFIG"


@pytest.mark.asyncio
async def test_bed_mesh_workflow_homes_measures_and_waits_for_save():
    printer = MockPrinter()
    manager = CalibrationManager(printer)
    await manager.start("bed_mesh", {})

    homed = await manager.action("bed_mesh", "home", {}, None)
    assert homed.state == "HOMED"
    measured = await manager.action("bed_mesh", "run", {}, None)

    assert measured.state == "REVIEW"
    assert printer.gcodes[:2] == ["G28", "BED_MESH_CALIBRATE PROFILE=default"]
    assert measured.data["result"]["profile_name"] == "default"


@pytest.mark.asyncio
async def test_screw_workflows_follow_their_interactive_protocols():
    tilt_printer = MockPrinter()
    tilt = CalibrationManager(tilt_printer)
    await tilt.start("screws_tilt", {})
    await tilt.action("screws_tilt", "home", {}, None)
    tilt_result = await tilt.action("screws_tilt", "calculate", {}, None)
    assert tilt_result.state == "REVIEW"
    assert tilt_printer.gcodes[-1] == "SCREWS_TILT_CALCULATE"

    manual_printer = MockPrinter()
    manual = CalibrationManager(manual_printer)
    await manual.start("bed_screws", {})
    await manual.action("bed_screws", "home", {}, None)
    adjusting = await manual.action("bed_screws", "run", {}, None)
    assert adjusting.state == "ADJUSTING"
    await manual.action("bed_screws", "next", {}, None)
    complete = await manual.action("bed_screws", "accept", {}, None)
    assert complete.state == "COMPLETE"
    assert manual_printer.gcodes[-3:] == ["BED_SCREWS_ADJUST", "ADJUSTED", "ACCEPT"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("wizard", "command"),
    [("z_tilt", "Z_TILT_ADJUST"), ("quad_gantry_level", "QUAD_GANTRY_LEVEL")],
)
async def test_gantry_workflows_home_and_level_without_save(wizard: str, command: str):
    printer = MockPrinter()
    manager = CalibrationManager(printer)
    await manager.start(wizard, {})

    await manager.action(wizard, "home", {}, None)
    result = await manager.action(wizard, "run", {}, None)

    assert result.state == "COMPLETE"
    assert printer.gcodes == ["G28", command]
    assert "SAVE_CONFIG" not in printer.gcodes


@pytest.mark.asyncio
async def test_probe_offset_workflow_uses_manual_probe_protocol():
    printer = MockPrinter()
    manager = CalibrationManager(printer)
    await manager.start("probe_offset", {})
    await manager.action("probe_offset", "home", {}, None)

    adjusting = await manager.action("probe_offset", "begin", {}, None)
    assert adjusting.state == "ADJUSTING"
    await manager.action("probe_offset", "testz", {"amount": -0.05}, None)
    review = await manager.action("probe_offset", "accept", {}, None)

    assert review.state == "REVIEW"
    assert printer.gcodes[-3:] == ["PROBE_CALIBRATE", "TESTZ Z=-0.05", "ACCEPT"]


@pytest.mark.asyncio
async def test_input_shaper_checks_all_configured_sensors_before_measurement():
    printer = MockPrinter()
    manager = CalibrationManager(printer)
    await manager.start("input_shaper", {"axis": "both"})

    checked = await manager.action("input_shaper", "check", {}, None)
    assert checked.state == "SENSOR_READY"
    await manager.action("input_shaper", "home", {}, None)
    measured = await manager.action("input_shaper", "run", {}, None)

    assert measured.state == "REVIEW"
    assert printer.gcodes == ["MEASURE_AXES_NOISE", "G28", "SHAPER_CALIBRATE"]


@pytest.mark.asyncio
async def test_pressure_advance_cancel_restores_original_runtime_settings():
    printer = MockPrinter()
    manager = CalibrationManager(printer)
    await manager.start("pressure_advance", {"drive": "direct"})
    await manager.action("pressure_advance", "prepare", {}, None)
    await manager.action("pressure_advance", "calculate", {"height": 10}, None)
    await manager.action("pressure_advance", "apply", {}, None)

    cancelled = await manager.action("pressure_advance", "cancel", {}, None)

    assert cancelled.state == "CANCELLED"
    assert "SET_PRESSURE_ADVANCE EXTRUDER=extruder ADVANCE=0.000000" in printer.gcodes[-1]
    assert "ACCEL=3000" in printer.gcodes[-1]


@pytest.mark.asyncio
async def test_pressure_advance_rejects_unknown_drive_type():
    manager = CalibrationManager(MockPrinter())

    with pytest.raises(WizardError, match="Direct Drive oder Bowden"):
        await manager.start("pressure_advance", {"drive": "invalid"})


@pytest.mark.asyncio
async def test_flow_requires_all_four_measurements():
    manager = CalibrationManager(MockPrinter())
    await manager.start("flow", {})

    with pytest.raises(WizardError, match="genau vier"):
        await manager.action(
            "flow",
            "calculate",
            {"expected": 0.4, "current": 100, "measurements": [0.4, 0.4, 0.4]},
            None,
        )


@pytest.mark.asyncio
async def test_flow_calculation_remains_available_while_printer_is_offline():
    printer = MockPrinter()
    printer.data.connected = False
    printer.data.state = "disconnected"
    manager = CalibrationManager(printer)

    await manager.start("flow", {})
    result = await manager.action(
        "flow",
        "calculate",
        {"expected": 0.4, "current": 100, "measurements": [0.4, 0.4, 0.4, 0.4]},
        None,
    )

    assert result.state == "COMPLETE"
    assert result.data["result"] == pytest.approx(100)


@pytest.mark.asyncio
async def test_pressure_advance_cannot_be_abandoned_during_test_print():
    printer = MockPrinter()
    manager = CalibrationManager(printer)
    await manager.start("pressure_advance", {"drive": "direct"})
    await manager.action("pressure_advance", "prepare", {}, None)
    printer.data.print_state = "printing"

    with pytest.raises(WizardError, match="Testdruck"):
        await manager.action("pressure_advance", "cancel", {}, None)

    assert manager.sessions["pressure_advance"].state == "PRINT_TOWER"


@pytest.mark.asyncio
async def test_pid_accepts_configured_secondary_extruder():
    printer = MockPrinter()
    printer.capability_data.heaters.append("extruder1")
    manager = CalibrationManager(printer)

    session = await manager.start("pid", {"heater": "extruder1", "target": 225})

    assert session.data["heater"] == "extruder1"
    assert session.data["target"] == 225


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
    restored = client.get("/api/wizards/extruder")
    assert restored.status_code == 200
    assert restored.json()["definition"]["id"] == "extruder"
    assert restored.json()["session"]["id"] == response.json()["id"]


def test_generic_session_can_be_restored_after_navigation(tmp_path: Path):
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
    started = client.post(
        "/api/wizards/pid/start",
        json={"options": {"heater": "extruder", "target": 220}},
    )

    restored = client.get("/api/wizards/pid/session")

    assert started.status_code == 200
    assert restored.status_code == 200
    assert restored.json()["id"] == started.json()["id"]
    assert restored.json()["state"] == "READY"


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


def test_pending_config_can_be_saved_before_calibration(tmp_path: Path):
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
    printer.data.save_config_pending = True
    printer.data.save_config_pending_items = {"extruder": {"control": "pid"}}
    client = TestClient(create_app(settings, printer))

    response = client.post("/api/pending-config/save")

    assert response.status_code == 200
    assert response.json() == {"status": "restarting", "action": "saved"}
    assert printer.gcodes[-1] == "SAVE_CONFIG"
    assert printer.data.save_config_pending is False
    assert printer.data.save_config_pending_items == {}


def test_pending_config_can_be_discarded_before_calibration(tmp_path: Path):
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
    printer.data.homed_axes = "xyz"
    printer.data.save_config_pending = True
    printer.data.save_config_pending_items = {"bed_mesh": {"profile": "default"}}
    client = TestClient(create_app(settings, printer))

    response = client.post("/api/pending-config/discard")

    assert response.status_code == 200
    assert response.json() == {"status": "restarting", "action": "discarded"}
    assert printer.data.save_config_pending is False
    assert printer.data.save_config_pending_items == {}
    assert printer.data.homed_axes == ""


def test_pending_config_resolution_is_blocked_during_print(tmp_path: Path):
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
    printer.data.print_state = "printing"
    printer.data.save_config_pending = True
    client = TestClient(create_app(settings, printer))

    response = client.post("/api/pending-config/discard")

    assert response.status_code == 409
    assert "während eines Drucks" in response.json()["detail"]
    assert printer.data.save_config_pending is True


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
    status = client.get("/api/status")
    assert status.status_code == 200
    assert status.json()["printer"]["state"] == "shutdown"
    assert status.json()["printer"]["state_message"] == "Emergency stop triggered"


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
