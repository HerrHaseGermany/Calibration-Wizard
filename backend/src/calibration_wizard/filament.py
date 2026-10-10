from __future__ import annotations

import asyncio
import secrets
from collections.abc import Callable, Iterable
from typing import Any

from .models import FilamentHeatRequest, FilamentMoveRequest
from .printer import PrinterAdapter, PrinterError
from .wizard import WizardError


class FilamentWizard:
    """Own filament heating, confirmation, motion locking, and progress."""

    def __init__(self, printer: PrinterAdapter, active_sessions: Callable[[], Iterable[Any]]):
        self.printer = printer
        self.active_sessions = active_sessions
        self.lock = asyncio.Lock()
        self.job = None
        self.progress = {"state": "idle"}

    @property
    def locked(self) -> bool:
        return self.lock.locked()

    async def require_ready(self):
        snapshot = await self.printer.snapshot()
        if not snapshot.connected or snapshot.state != "ready":
            raise WizardError(
                "Klipper muss für den Filamentwechsel bereit sein.",
                message_key="ui.klipper_must_be_ready_for_a_filament_change",
            )
        if snapshot.print_state == "printing":
            raise WizardError(
                "Filamentwechsel ist während eines laufenden Drucks gesperrt.",
                message_key="ui.filament_changes_are_blocked_while_printing",
            )
        terminal = {"COMPLETE", "CANCELLED", "ERROR"}
        sessions = self.active_sessions()
        if any(item and item.state not in terminal for item in sessions):
            raise WizardError(
                "Beende zuerst die laufende Kalibrierung.",
                message_key="ui.finish_the_active_calibration_first",
            )
        return snapshot

    async def heat(self, payload: FilamentHeatRequest):
        if self.lock.locked():
            raise WizardError(
                "Filamentbewegung läuft bereits.",
                message_key="ui.a_filament_move_is_already_running",
            )
        async with self.lock:
            snapshot = await self.require_ready()
            if payload.temperature and payload.temperature < snapshot.min_extrude_temp:
                raise WizardError(
                    "Zieltemperatur liegt unter der Mindest-Extrusionstemperatur.",
                    message_key="ui.target_temperature_is_below_the_minimum_extrusion_temperature",
                )
            try:
                config_status = await self.printer.query_objects({"configfile": ["settings"]})
                extruder_settings = (
                    config_status.get("configfile", {})
                    .get("settings", {})
                    .get(snapshot.extruder, {})
                )
                maximum = float(extruder_settings.get("max_temp", 300))
                if payload.temperature and payload.temperature >= maximum:
                    raise WizardError(
                        "Zieltemperatur muss unter Klippers max_temp liegen.",
                        message_key="ui.target_temperature_must_be_below_klipper_s_max_temp",
                    )
                await self.printer.heat(snapshot.extruder, payload.temperature)
            except PrinterError as exc:
                raise WizardError(exc) from exc
            self.job = (
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
            "confirmation_token": self.job["token"] if self.job else None,
        }

    async def move(self, direction: str, payload: FilamentMoveRequest):
        if self.lock.locked():
            raise WizardError(
                "Filamentbewegung läuft bereits.",
                message_key="ui.a_filament_move_is_already_running",
            )
        async with self.lock:
            snapshot = await self.require_ready()
            if (
                not self.job
                or not secrets.compare_digest(payload.confirmation_token, self.job["token"])
                or self.job["direction"] != direction
                or self.job["extruder"] != snapshot.extruder
            ):
                raise WizardError(
                    "Starte den Filamentvorgang erneut.",
                    message_key="ui.start_the_filament_process_again",
                )
            if not snapshot.can_extrude or snapshot.temperature < snapshot.min_extrude_temp:
                raise WizardError(
                    "Das Hotend hat die Mindest-Extrusionstemperatur nicht erreicht.",
                    message_key="ui.the_hotend_has_not_reached_the_minimum_extrusion_temperature",
                )
            if (
                abs(snapshot.target - self.job["temperature"]) > 0.1
                or snapshot.temperature < self.job["temperature"] - 2
            ):
                raise WizardError(
                    "Die gewählte Zieltemperatur ist noch nicht erreicht.",
                    message_key="ui.the_selected_target_temperature_has_not_been_reached_yet",
                )
            self.job = None
            total = 102 if direction == "load" else 105
            self.progress = {
                "operation_id": payload.confirmation_token,
                "state": "running",
                "direction": direction,
                "completed": 0,
                "total": total,
                "percent": 0,
            }
            try:
                moves = [100, -2] if direction == "load" else [5, -100]
                for distance in moves:
                    remaining = abs(distance)
                    while remaining > 0:
                        chunk = min(10, remaining)
                        await self.printer.extrude(
                            snapshot.extruder, chunk if distance > 0 else -chunk, payload.speed
                        )
                        remaining -= chunk
                        completed = self.progress["completed"] + chunk
                        self.progress = {
                            **self.progress,
                            "completed": completed,
                            "percent": round(completed / total * 100, 1),
                        }
            except PrinterError as exc:
                self.progress = {**self.progress, "state": "error"}
                raise WizardError(exc) from exc
            self.progress = {**self.progress, "state": "complete"}
        return {"status": "complete", "direction": direction, "distance": 100}
