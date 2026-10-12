from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .advanced import CalibrationManager
from .configuration import KlipperConfigRepository
from .filament import FilamentWizard
from .mainsail_integration import MainsailIntegration
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
from .printer import MockPrinter, MoonrakerPrinter, PrinterAdapter
from .settings import Settings
from .setup import CalibrationSetupManager
from .wizard import WIZARDS, ExtruderWizard, WizardError

LOGGER = logging.getLogger(__name__)


class LocalizedHTTPException(HTTPException):
    def __init__(self, status_code: int, detail: str, message_key: str):
        super().__init__(status_code=status_code, detail=detail)
        self.message_key = message_key


def _check_same_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin and urlsplit(origin).netloc != request.headers.get("host"):
        raise LocalizedHTTPException(
            403, "Cross-origin state changes are not allowed", "errors.cross_origin"
        )


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
    filament = FilamentWizard(printer, lambda: [wizard.session, *calibrations.sessions.values()])
    integration = MainsailIntegration(
        settings.mainsail_dir,
        settings.mainsail_state_dir or settings.backup_dir / "mainsail",
        enabled=settings.mainsail_repair_enabled and not settings.mock,
    )
    repair_lock = asyncio.Lock()

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
    app.state.mainsail_integration = integration

    @app.middleware("http")
    async def frontend_cache_control(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/assets/") or not request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    @app.exception_handler(WizardError)
    async def wizard_error_handler(_request: Request, exc: WizardError):
        LOGGER.warning("Wizard request rejected: %s", exc)
        return JSONResponse(
            status_code=409,
            content={
                "detail": str(exc),
                "code": "wizard_error",
                "message_key": exc.message_key,
                "message_params": exc.message_params,
            },
        )

    @app.exception_handler(LocalizedHTTPException)
    async def http_error_handler(_request: Request, exc: LocalizedHTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "message_key": exc.message_key, "message_params": {}},
        )

    @app.get("/api/status")
    async def status():
        snapshot = await printer.snapshot()
        sessions = [wizard.session, *calibrations.sessions.values()]
        active = any(
            s and s.state not in {"COMPLETE", "CANCELLED", "ERROR", "IDLE"} for s in sessions
        )
        return {
            "service": "ok",
            "version": __version__,
            "mode": "mock" if settings.mock else "moonraker",
            "printer": snapshot,
            "wizard_state": wizard.session.state if wizard.session else WizardState.IDLE,
            "integration_idle": snapshot.connected
            and snapshot.state == "ready"
            and snapshot.print_state not in {"printing", "paused"}
            and not active
            and not filament.locked,
        }

    @app.get("/api/printer")
    async def printer_status():
        return await printer.snapshot()

    @app.get("/api/mainsail/integration")
    async def mainsail_integration_status():
        return await asyncio.to_thread(integration.status)

    @app.get("/api/mainsail/entry")
    async def mainsail_entry():
        current = await asyncio.to_thread(integration.status)
        if current["healthy"]:
            return FileResponse(
                settings.mainsail_dir / "index.html", headers={"Cache-Control": "no-store"}
            )
        return RedirectResponse("/api/klipper-tools/", status_code=307)

    @app.post("/api/mainsail/repair")
    async def repair_mainsail(request: Request):
        _check_same_origin(request)
        async with repair_lock:
            current = await asyncio.to_thread(integration.status)
            if not current["can_repair"]:
                raise WizardError(
                    "Repair unavailable", message_key="integration.errors.unavailable"
                )
            snapshot = await printer.snapshot()
            sessions = [wizard.session, *calibrations.sessions.values()]
            active = any(
                s and s.state not in {"COMPLETE", "CANCELLED", "ERROR", "IDLE"} for s in sessions
            )
            if (
                not snapshot.connected
                or snapshot.state != "ready"
                or snapshot.print_state in {"printing", "paused"}
                or active
                or filament.locked
            ):
                raise WizardError("Printer must be idle", message_key="integration.errors.busy")
            try:
                await asyncio.to_thread(integration.request_repair)
            except ValueError as exc:
                raise WizardError(
                    "Repair already queued or running", message_key="integration.errors.unavailable"
                ) from exc
            except OSError as exc:
                raise WizardError(
                    "Repair queue is not writable", message_key="integration.errors.write"
                ) from exc
            return {"status": "queued"}

    @app.post("/api/emergency-stop")
    async def emergency_stop(request: Request):
        _check_same_origin(request)
        await printer.emergency_stop()
        return {"status": "shutdown"}

    async def require_pending_config() -> None:
        snapshot = await printer.snapshot()
        if not snapshot.connected or snapshot.state != "ready":
            raise WizardError(
                "Klipper muss bereit sein, um offene Konfigurationswerte aufzulösen.",
                message_key="ui.klipper_must_be_ready_to_resolve_pending_configuration_values",
            )
        if snapshot.print_state in {"printing", "paused"}:
            raise WizardError(
                "Offene Konfigurationswerte können nicht während eines Drucks aufgelöst werden.",
                message_key="ui.pending_configuration_values_cannot_be_resolved_during_a_print",
            )
        if not snapshot.save_config_pending:
            raise WizardError(
                "Klipper hat keine ungespeicherten SAVE_CONFIG-Werte.",
                message_key="ui.klipper_has_no_unsaved_save_config_values",
            )

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

    @app.post("/api/tools/filament/heat")
    async def filament_heat(payload: FilamentHeatRequest, request: Request):
        _check_same_origin(request)
        return await filament.heat(payload)

    @app.get("/api/tools/filament/progress")
    async def filament_progress_status():
        return filament.progress

    @app.post("/api/tools/filament/{direction}")
    async def filament_move(direction: str, payload: FilamentMoveRequest, request: Request):
        _check_same_origin(request)
        if direction not in {"load", "unload"}:
            raise LocalizedHTTPException(
                404, "Unknown filament action", "errors.unknown_filament_action"
            )
        return await filament.move(direction, payload)

    @app.get("/api/wizards/extruder")
    async def extruder_status():
        definition = next(item for item in WIZARDS if item.id == "extruder")
        return {"definition": definition, "session": wizard.session}

    @app.post("/api/wizards/extruder/start")
    async def start(payload: StartRequest, request: Request):
        _check_same_origin(request)
        xyz = calibrations.sessions.get("xyz")
        if xyz and xyz.state not in {"COMPLETE", "CANCELLED", "ERROR"}:
            raise WizardError("Active XYZ check", message_key="xyz.errors.active")
        if filament.locked:
            raise WizardError(
                "Filamentbewegung läuft bereits.",
                message_key="ui.a_filament_move_is_already_running",
            )
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
        return {
            "session": session,
            "message": message,
            "message_key": message.message_key,
            "message_params": message.message_params,
        }

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
        if (
            wizard_id == "xyz"
            and wizard.session
            and wizard.session.state
            not in {WizardState.COMPLETE, WizardState.CANCELLED, WizardState.ERROR}
        ):
            raise WizardError("Active extruder calibration", message_key="xyz.errors.active")
        if filament.locked:
            raise WizardError(
                "Filamentbewegung läuft bereits.",
                message_key="ui.a_filament_move_is_already_running",
            )
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
    for tool in ("filament", "xyz"):
        tool_assets = Path(__file__).resolve().parents[3] / "wizards" / tool
        if tool_assets.is_dir():
            app.mount(
                f"/assets/wizards/{tool}",
                StaticFiles(directory=tool_assets),
                name=f"{tool}-assets",
            )
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend_route(path: str):
        index = frontend / "index.html"
        if not index.is_file():
            raise LocalizedHTTPException(
                404, "Frontend is not installed", "errors.frontend_missing"
            )
        requested = (frontend / path).resolve()
        try:
            requested.relative_to(frontend.resolve())
        except ValueError:
            requested = Path("/invalid")
        if requested.is_file():
            return FileResponse(requested)
        return FileResponse(index)

    return app
