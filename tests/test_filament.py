import asyncio

import httpx
import pytest
from calibration_wizard.api import create_app
from calibration_wizard.printer import MockPrinter, MoonrakerPrinter, PrinterError
from calibration_wizard.settings import Settings
from fastapi.testclient import TestClient


@pytest.fixture
def filament_client():
    printer = MockPrinter()
    client = TestClient(create_app(Settings.from_env(), printer))
    return client, printer


def test_load_unload_and_heater_off(filament_client):
    client, printer = filament_client
    for direction in ("load", "unload"):
        response = client.post(
            "/api/tools/filament/heat", json={"temperature": 210, "direction": direction}
        )
        assert response.status_code == 200
        token = response.json()["confirmation_token"]
        printer.data.temperature = 210
        response = client.post(
            f"/api/tools/filament/{direction}", json={"confirmation_token": token, "speed": 2}
        )
        assert response.status_code == 200
        assert response.json()["distance"] == 100
        assert (
            client.post(
                f"/api/tools/filament/{direction}", json={"confirmation_token": token}
            ).status_code
            == 409
        )
    assert printer.extrusions == [10] * 10 + [-2, 5] + [-10] * 10
    assert client.post("/api/tools/filament/heat", json={"temperature": 0}).status_code == 200
    assert printer.data.target == 0


@pytest.mark.parametrize("state", ["printing", "paused"])
def test_filament_is_blocked_during_prints(filament_client, state):
    client, printer = filament_client
    printer.data.print_state = state
    for action, values in [
        ("heat", {"temperature": 200}),
        ("load", {"confirmation_token": "invalid"}),
        ("unload", {"confirmation_token": "invalid"}),
    ]:
        assert client.post(f"/api/tools/filament/{action}", json=values).status_code == 409
    assert printer.extrusions == []
    assert printer.data.target == 0


def test_cold_disconnected_and_calibrating_are_blocked(filament_client):
    client, printer = filament_client
    assert (
        client.post("/api/tools/filament/load", json={"confirmation_token": "invalid"}).status_code
        == 409
    )
    printer.data.connected = False
    assert client.post("/api/tools/filament/heat", json={"temperature": 200}).status_code == 409
    printer.data.connected = True
    assert client.post("/api/wizards/extruder/start", json={}).status_code == 200
    assert client.post("/api/tools/filament/heat", json={"temperature": 200}).status_code == 409
    assert printer.extrusions == []


@pytest.mark.parametrize("values", [{"speed": 0}, {"speed": 6}, {"speed": -1}])
def test_invalid_movement_is_rejected(filament_client, values):
    client, printer = filament_client
    assert (
        client.post(
            "/api/tools/filament/load", json={"confirmation_token": "invalid", **values}
        ).status_code
        == 422
    )
    assert printer.extrusions == []


def test_temperature_limits(filament_client):
    client, printer = filament_client
    assert client.post("/api/tools/filament/heat", json={"temperature": 100}).status_code == 409
    assert client.post("/api/tools/filament/heat", json={"temperature": 301}).status_code == 422
    assert client.post("/api/tools/filament/heat", json={"temperature": 300}).status_code == 409
    assert printer.data.target == 0


def test_cross_origin_is_rejected(filament_client):
    client, printer = filament_client
    assert (
        client.post(
            "/api/tools/filament/heat",
            json={"temperature": 200},
            headers={"origin": "http://other"},
        ).status_code
        == 403
    )
    assert printer.data.target == 0


@pytest.mark.asyncio
async def test_unload_sends_negative_chunks_and_restores_state():
    printer = MoonrakerPrinter("http://moonraker")
    mock = MockPrinter()
    mock.data.temperature = 200
    mock.data.max_extrude_only_distance = 30
    printer.snapshot = mock.snapshot
    scripts = []

    def handle(request):
        import json

        scripts.append(json.loads(request.content)["script"])
        assert request.extensions["timeout"]["read"] is None
        return httpx.Response(200, json={"result": "ok"})

    await printer.client.aclose()
    printer.client = httpx.AsyncClient(
        base_url="http://moonraker", transport=httpx.MockTransport(handle)
    )
    await printer.extrude("extruder", -75, 2)
    await printer.client.aclose()
    script = scripts[0]
    assert script.count("G1 E-30.00000 F120.0") == 2
    assert "G1 E-15.00000 F120.0" in script
    assert "M83" in script
    assert "RESTORE_GCODE_STATE" in script
    assert "MOVE=0" in script


def test_target_temperature_direction_and_extruder_are_checked(filament_client):
    client, printer = filament_client
    printer.heating_rate = 0
    printer.data.temperature = 180
    result = client.post("/api/tools/filament/heat", json={"temperature": 240})
    token = result.json()["confirmation_token"]
    values = {"confirmation_token": token}
    assert client.post("/api/tools/filament/load", json=values).status_code == 409
    printer.data.temperature = 240
    assert client.post("/api/tools/filament/unload", json=values).status_code == 409
    printer.data.extruder = "extruder1"
    assert client.post("/api/tools/filament/load", json=values).status_code == 409
    printer.data.extruder = "extruder"
    printer.data.target = 210
    assert client.post("/api/tools/filament/load", json=values).status_code == 409
    assert printer.extrusions == []


def test_filament_change_allows_a_different_material(filament_client):
    client, printer = filament_client
    speeds = []
    extrude = printer.extrude

    async def record_speed(extruder, distance, speed):
        speeds.append(speed)
        await extrude(extruder, distance, speed)

    printer.extrude = record_speed
    for direction, temperature in [("unload", 240), ("load", 210)]:
        result = client.post(
            "/api/tools/filament/heat", json={"direction": direction, "temperature": temperature}
        )
        printer.data.temperature = temperature
        response = client.post(
            f"/api/tools/filament/{direction}",
            json={"confirmation_token": result.json()["confirmation_token"]},
        )
        assert response.status_code == 200
    assert printer.extrusions == [5] + [-10] * 10 + [10] * 10 + [-2]
    assert speeds == [5] * 22
    assert printer.data.target == 210


def test_heater_off_invalidates_confirmation(filament_client):
    client, printer = filament_client
    result = client.post("/api/tools/filament/heat", json={"temperature": 210})
    printer.data.temperature = 210
    client.post("/api/tools/filament/heat", json={"temperature": 0})
    assert (
        client.post(
            "/api/tools/filament/load",
            json={"confirmation_token": result.json()["confirmation_token"]},
        ).status_code
        == 409
    )
    assert printer.extrusions == []


@pytest.mark.asyncio
async def test_movement_progress_tracks_completed_chunks_and_blocks_other_moves():
    waiting = asyncio.Event()
    release = asyncio.Event()

    class SlowPrinter(MockPrinter):
        async def extrude(self, extruder, distance, speed):
            if len(self.extrusions) == 1:
                waiting.set()
                await release.wait()
            await super().extrude(extruder, distance, speed)

    printer = SlowPrinter()
    printer.data.temperature = 210
    app = create_app(Settings.from_env(), printer)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        heated = await client.post("/api/tools/filament/heat", json={"temperature": 210})
        token = heated.json()["confirmation_token"]
        task = asyncio.create_task(
            client.post("/api/tools/filament/load", json={"confirmation_token": token})
        )
        try:
            await asyncio.wait_for(waiting.wait(), timeout=2)
            progress = (await client.get("/api/tools/filament/progress")).json()
            assert progress["operation_id"] == token
            assert progress["state"] == "running"
            assert progress["completed"] == 10
            assert progress["total"] == 102
            assert 0 < progress["percent"] < 100
            second = await client.post(
                "/api/tools/filament/load", json={"confirmation_token": token}
            )
            assert second.status_code == 409
        finally:
            release.set()
            result = await task
        assert result.status_code == 200
        progress = (await client.get("/api/tools/filament/progress")).json()
        assert progress["state"] == "complete"
        assert progress["percent"] == 100
        assert progress["completed"] == 102


def test_failed_movement_does_not_report_completion():
    class FailingPrinter(MockPrinter):
        async def extrude(self, extruder, distance, speed):
            if self.extrusions:
                raise PrinterError("Movement interrupted")
            await super().extrude(extruder, distance, speed)

    printer = FailingPrinter()
    printer.data.temperature = 210
    client = TestClient(create_app(Settings.from_env(), printer))
    result = client.post("/api/tools/filament/heat", json={"temperature": 210})
    response = client.post(
        "/api/tools/filament/unload",
        json={"confirmation_token": result.json()["confirmation_token"]},
    )
    # The heat step defaults to loading; choose unloading explicitly.
    assert response.status_code == 409
    result = client.post(
        "/api/tools/filament/heat", json={"temperature": 210, "direction": "unload"}
    )
    response = client.post(
        "/api/tools/filament/unload",
        json={"confirmation_token": result.json()["confirmation_token"]},
    )
    assert response.status_code == 409
    progress = client.get("/api/tools/filament/progress").json()
    assert progress["state"] == "error"
    assert progress["completed"] == 5
    assert progress["percent"] < 100
