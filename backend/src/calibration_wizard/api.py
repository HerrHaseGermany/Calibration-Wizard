from __future__ import annotations

import asyncio
import logging
import secrets
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .advanced import CalibrationManager
from .configuration import KlipperConfigRepository
from .models import (
    CalibrationActionRequest,
    CalibrationStartRequest,
    FilamentHeatRequest,
    FilamentMoveRequest,
    HeatRequest,
    MeasurementRequest,
    SaveRequest,
    SetupPreviewRequest,
    SetupSaveRequest,
    StartRequest,
    WizardState,
)
from .printer import MockPrinter, MoonrakerPrinter, PrinterAdapter, PrinterError
from .settings import Settings
from .setup import CalibrationSetupManager
from .wizard import WIZARDS, ExtruderWizard, WizardError

LOGGER = logging.getLogger(__name__)


def _check_same_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin and urlsplit(origin).netloc != request.headers.get("host"):
        raise HTTPException(status_code=403, detail="Cross-origin state changes are not allowed")


def create_app(
    settings: Settings | None = None,
    printer: PrinterAdapter | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    printer = printer or (
        MockPrinter()
        if settings.mock
        else MoonrakerPrinter(settings.moonraker_url, settings.moonraker_api_key)
    )
    config = None
    if settings.klipper_config:
        config = KlipperConfigRepository(settings.klipper_config, settings.backup_dir)
    wizard = ExtruderWizard(printer, config)
    calibrations = CalibrationManager(printer, config)
    setup_manager = CalibrationSetupManager(printer, config)
    filament_lock = asyncio.Lock()
    filament_job = None

    app = FastAPI(
        title="Klipper Calibration Wizard",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.state.settings = settings
    app.state.printer = printer
    app.state.wizard = wizard
    app.state.calibrations = calibrations
    app.state.setup_manager = setup_manager

    @app.middleware("http")
    async def frontend_cache_control(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/assets/") or not request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    @app.exception_handler(WizardError)
    async def wizard_error_handler(_request: Request, exc: WizardError):
        from fastapi.responses import JSONResponse

        LOGGER.warning("Wizard request rejected: %s", exc)
        return JSONResponse(status_code=409, content={"detail": str(exc), "code": "wizard_error"})

    @app.get("/api/status")
    async def status():
        snapshot = await printer.snapshot()
        return {
            "service": "ok",
            "version": __version__,
            "mode": "mock" if settings.mock else "moonraker",
            "printer": snapshot,
            "wizard_state": wizard.session.state if wizard.session else WizardState.IDLE,
        }

    @app.get("/api/printer")
    async def printer_status():
        return await printer.snapshot()

    @app.post("/api/emergency-stop")
    async def emergency_stop(request: Request):
        _check_same_origin(request)
        await printer.emergency_stop()
        return {"status": "shutdown"}

    async def require_pending_config() -> None:
        snapshot = await printer.snapshot()
        if not snapshot.connected or snapshot.state != "ready":
            raise WizardError("Klipper muss bereit sein, um offene Konfigurationswerte aufzulösen.")
        if snapshot.print_state in {"printing", "paused"}:
            raise WizardError(
                "Offene Konfigurationswerte können nicht während eines Drucks aufgelöst werden."
            )
        if not snapshot.save_config_pending:
            raise WizardError("Klipper hat keine ungespeicherten SAVE_CONFIG-Werte.")

    @app.post("/api/pending-config/save")
    async def save_pending_config(request: Request):
        _check_same_origin(request)
        await require_pending_config()
        await printer.run_gcode("SAVE_CONFIG", long_running=True)
        return {"status": "restarting", "action": "saved"}

    @app.post("/api/pending-config/discard")
    async def discard_pending_config(request: Request):
        _check_same_origin(request)
        await require_pending_config()
        await printer.restart()
        return {"status": "restarting", "action": "discarded"}

    @app.get("/api/wizards")
    async def list_wizards():
        return await calibrations.definitions(WIZARDS)

    async def require_filament_ready():
        snapshot = await printer.snapshot()
        if not snapshot.connected or snapshot.state != "ready":
            raise WizardError("Klipper muss für den Filamentwechsel bereit sein.")
        if snapshot.print_state in {"printing", "paused"}:
            raise WizardError("Filamentwechsel ist während eines Drucks oder einer Pause gesperrt.")
        terminal = {"COMPLETE", "CANCELLED", "ERROR"}
        sessions = [wizard.session, *calibrations.sessions.values()]
        if any(item and item.state not in terminal for item in sessions):
            raise WizardError("Beende zuerst die laufende Kalibrierung.")
        return snapshot

    @app.post("/api/tools/filament/heat")
    async def filament_heat(payload: FilamentHeatRequest, request: Request):
        nonlocal filament_job
        _check_same_origin(request)
        if filament_lock.locked():
            raise WizardError("Filamentbewegung läuft bereits.")
        async with filament_lock:
            snapshot = await require_filament_ready()
            if payload.temperature and payload.temperature < snapshot.min_extrude_temp:
                raise WizardError("Zieltemperatur liegt unter der Mindest-Extrusionstemperatur.")
            try:
                config_status = await printer.query_objects({"configfile": ["settings"]})
                extruder_settings = (
                    config_status.get("configfile", {})
                    .get("settings", {})
                    .get(snapshot.extruder, {})
                )
                maximum = float(extruder_settings.get("max_temp", 300))
                if payload.temperature and payload.temperature >= maximum:
                    raise WizardError("Zieltemperatur muss unter Klippers max_temp liegen.")
                await printer.heat(snapshot.extruder, payload.temperature)
            except PrinterError as exc:
                raise WizardError(str(exc)) from exc
            filament_job = (
                {
                    "token": secrets.token_urlsafe(32),
                    "extruder": snapshot.extruder,
                    "temperature": payload.temperature,
                    "direction": payload.direction,
                }
                if payload.temperature
                else None
            )
        return {
            "status": "heating" if payload.temperature else "heater_off",
            "confirmation_token": filament_job["token"] if filament_job else None,
        }

    @app.post("/api/tools/filament/{direction}")
    async def filament_move(direction: str, payload: FilamentMoveRequest, request: Request):
        nonlocal filament_job
        _check_same_origin(request)
        if direction not in {"load", "unload"}:
            raise HTTPException(status_code=404, detail="Unknown filament action")
        if filament_lock.locked():
            raise WizardError("Filamentbewegung läuft bereits.")
        async with filament_lock:
            snapshot = await require_filament_ready()
            if (
                not filament_job
                or not secrets.compare_digest(payload.confirmation_token, filament_job["token"])
                or filament_job["direction"] != direction
                or filament_job["extruder"] != snapshot.extruder
            ):
                raise WizardError("Starte den Filamentvorgang erneut.")
            if not snapshot.can_extrude or snapshot.temperature < snapshot.min_extrude_temp:
                raise WizardError("Das Hotend hat die Mindest-Extrusionstemperatur nicht erreicht.")
            if (
                abs(snapshot.target - filament_job["temperature"]) > 0.1
                or snapshot.temperature < filament_job["temperature"] - 2
            ):
                raise WizardError("Die gewählte Zieltemperatur ist noch nicht erreicht.")
            filament_job = None
            try:
                if direction == "load":
                    await printer.extrude(snapshot.extruder, 100, payload.speed)
                    await printer.extrude(snapshot.extruder, -2, payload.speed)
                else:
                    await printer.extrude(snapshot.extruder, 5, payload.speed)
                    await printer.extrude(snapshot.extruder, -100, payload.speed)
            except PrinterError as exc:
                raise WizardError(str(exc)) from exc
        return {"status": "complete", "direction": direction, "distance": 100}

    @app.get("/api/wizards/extruder")
    async def extruder_status():
        definition = next(item for item in WIZARDS if item.id == "extruder")
        return {"definition": definition, "session": wizard.session}

    @app.post("/api/wizards/extruder/start")
    async def start(payload: StartRequest, request: Request):
        _check_same_origin(request)
        if filament_lock.locked():
            raise WizardError("Filamentbewegung läuft bereits.")
        return await wizard.start(payload.mark_distance, payload.commanded_extrusion)

    @app.post("/api/wizards/extruder/heat")
    async def heat(payload: HeatRequest, request: Request):
        _check_same_origin(request)
        return await wizard.heat(payload.temperature)

    @app.post("/api/wizards/extruder/ready")
    async def ready(request: Request):
        _check_same_origin(request)
        return await wizard.ready()

    @app.post("/api/wizards/extruder/extrude")
    async def extrude(request: Request):
        _check_same_origin(request)
        return await wizard.extrude()

    @app.post("/api/wizards/extruder/measurement")
    async def measurement(payload: MeasurementRequest, request: Request):
        _check_same_origin(request)
        return await wizard.measurement(payload.remaining_distance)

    @app.post("/api/wizards/extruder/apply")
    async def apply(request: Request):
        _check_same_origin(request)
        return await wizard.apply()

    @app.post("/api/wizards/extruder/measure-again")
    async def measure_again(request: Request):
        _check_same_origin(request)
        return await wizard.measure_again()

    @app.post("/api/wizards/extruder/verify/extrude")
    async def verify_extrude(request: Request):
        _check_same_origin(request)
        return await wizard.extrude(verification=True)

    @app.post("/api/wizards/extruder/verify/measurement")
    async def verify_measurement(payload: MeasurementRequest, request: Request):
        _check_same_origin(request)
        return await wizard.measurement(payload.remaining_distance, verification=True)

    @app.post("/api/wizards/extruder/save")
    async def save(payload: SaveRequest, request: Request):
        _check_same_origin(request)
        session, message = await wizard.save(
            payload.confirmation_token,
            payload.old_rotation_distance,
            payload.new_rotation_distance,
        )
        return {"session": session, "message": message}

    @app.post("/api/wizards/extruder/cancel")
    async def cancel(request: Request):
        _check_same_origin(request)
        return await wizard.cancel()

    @app.get("/api/wizards/{wizard_id}/session")
    async def calibration_status(wizard_id: str):
        return calibrations.sessions.get(wizard_id)

    @app.post("/api/wizards/{wizard_id}/start")
    async def calibration_start(wizard_id: str, payload: CalibrationStartRequest, request: Request):
        _check_same_origin(request)
        if filament_lock.locked():
            raise WizardError("Filamentbewegung läuft bereits.")
        return await calibrations.start(wizard_id, payload.options)

    @app.post("/api/wizards/{wizard_id}/action")
    async def calibration_action(
        wizard_id: str, payload: CalibrationActionRequest, request: Request
    ):
        _check_same_origin(request)
        return await calibrations.action(
            wizard_id, payload.action, payload.values, payload.confirmation_token
        )

    @app.get("/api/setup/{wizard_id}")
    async def setup_status(wizard_id: str):
        return await setup_manager.describe(wizard_id)

    @app.post("/api/setup/{wizard_id}/preview")
    async def setup_preview(wizard_id: str, payload: SetupPreviewRequest, request: Request):
        _check_same_origin(request)
        return await setup_manager.preview(wizard_id, payload.values)

    @app.post("/api/setup/{wizard_id}/save")
    async def setup_save(wizard_id: str, payload: SetupSaveRequest, request: Request):
        _check_same_origin(request)
        return await setup_manager.save(
            wizard_id, payload.values, payload.confirmation_token, payload.restart
        )

    @app.websocket("/api/events")
    async def events(websocket: WebSocket):
        origin = websocket.headers.get("origin")
        host = websocket.headers.get("host", "")
        if origin and urlsplit(origin).netloc != host:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        try:
            while True:
                snapshot = await printer.snapshot()
                await websocket.send_json(
                    {
                        "type": "status",
                        "printer": snapshot.model_dump(mode="json"),
                        "session": wizard.session.model_dump(mode="json")
                        if wizard.session
                        else None,
                        "calibrations": {
                            key: value.model_dump(mode="json")
                            for key, value in calibrations.sessions.items()
                        },
                    }
                )
                await asyncio.sleep(1)
        except WebSocketDisconnect:
            return

    frontend = settings.frontend_dir
    assets = frontend / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend_route(path: str):
        index = frontend / "index.html"
        if not index.is_file():
            raise HTTPException(status_code=404, detail="Frontend is not installed")
        requested = (frontend / path).resolve()
        try:
            requested.relative_to(frontend.resolve())
        except ValueError:
            requested = Path("/invalid")
        if requested.is_file():
            return FileResponse(requested)
        return FileResponse(index)

    return app
