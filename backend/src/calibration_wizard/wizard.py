from __future__ import annotations

import asyncio
import json
import secrets
from dataclasses import dataclass
from pathlib import Path

from .calculation import ValidationError, calculate_rotation_distance
from .configuration import ConfigError, KlipperConfigRepository
from .errors import LocalizedErrorMixin, Message
from .models import PrinterSnapshot, WizardSession, WizardState
from .printer import PrinterAdapter, PrinterError


class WizardError(LocalizedErrorMixin, RuntimeError):
    pass


@dataclass(frozen=True)
class WizardDefinition:
    id: str
    name: str
    description: str
    available: bool
    required_features: tuple[str, ...]
    category: str = "calibration"


def load_wizard_definitions(root: Path | None = None) -> tuple[WizardDefinition, ...]:
    root = root or Path(__file__).resolve().parents[3] / "wizards"
    definitions: list[WizardDefinition] = []
    for manifest in sorted(root.glob("*/manifest.json")):
        data = json.loads(manifest.read_text(encoding="utf-8"))
        definitions.append(
            WizardDefinition(
                id=data["id"],
                name=data["name"],
                description=data["description"],
                available=bool(data["available"]),
                required_features=tuple(data.get("requirements", ())),
                category=data.get("category", "calibration"),
            )
        )
    if not definitions:
        raise RuntimeError(f"No wizard manifests found below {root}")
    order = {
        "filament": -1,
        "pid": 0,
        "extruder": 1,
        "bed_screws": 2,
        "screws_tilt": 3,
        "z_tilt": 4,
        "quad_gantry_level": 5,
        "probe_offset": 6,
        "bed_mesh": 7,
        "flow": 8,
        "input_shaper": 9,
        "pressure_advance": 10,
    }
    return tuple(sorted(definitions, key=lambda item: order.get(item.id, 99)))


WIZARDS = load_wizard_definitions()


class ExtruderWizard:
    def __init__(
        self,
        printer: PrinterAdapter,
        config: KlipperConfigRepository | None = None,
    ) -> None:
        self.printer = printer
        self.config = config
        self.session: WizardSession | None = None
        self._lock = asyncio.Lock()

    def _require(self, *states: WizardState) -> WizardSession:
        if self.session is None:
            raise WizardError(
                "No calibration session is active",
                message_key="ui.no_calibration_session_is_active",
            )
        if self.session.state not in states:
            expected = ", ".join(state.value for state in states)
            raise WizardError(
                f"Action is not allowed in {self.session.state.value}; expected {expected}",
                message_key="ui.action_is_not_allowed_in_value_expected_value",
                message_params={"state": self.session.state.value, "expected": expected},
            )
        return self.session

    async def _safe_snapshot(self) -> PrinterSnapshot:
        snapshot = await self.printer.snapshot()
        if not snapshot.connected:
            if self.session:
                self.session.state = WizardState.ERROR
                self.session.error = "Printer connection lost"
                self.session.error_key = "ui.printer_connection_lost"
            raise WizardError("Printer connection lost", message_key="ui.printer_connection_lost")
        if snapshot.state != "ready":
            if self.session:
                self.session.state = WizardState.ERROR
                self.session.error = f"Klipper state is {snapshot.state}"
                self.session.error_key = "ui.klipper_state_is_value"
                self.session.error_params = {"state": snapshot.state}
            raise WizardError(
                f"Klipper must be ready (current state: {snapshot.state})",
                message_key="ui.klipper_must_be_ready_current_state_value",
                message_params={"state": snapshot.state},
            )
        if snapshot.print_state in {"printing", "paused"}:
            raise WizardError(
                "Extruder calibration is blocked while a print is active or paused",
                message_key="ui.extruder_calibration_is_blocked_while_a_print_is_active_or",
            )
        return snapshot

    async def start(self, mark_distance: float, commanded_extrusion: float) -> WizardSession:
        if mark_distance <= 0 or commanded_extrusion <= 0:
            raise WizardError(
                "Distances must be positive", message_key="ui.distances_must_be_positive"
            )
        if mark_distance <= commanded_extrusion:
            raise WizardError(
                "Mark distance must be greater than extrusion distance",
                message_key="ui.mark_distance_must_be_greater_than_extrusion_distance",
            )
        if mark_distance > 1000 or commanded_extrusion > 500:
            raise WizardError(
                "Requested distances exceed safety limits",
                message_key="ui.requested_distances_exceed_safety_limits",
            )
        async with self._lock:
            snapshot = await self._safe_snapshot()
            if snapshot.rotation_distance <= 0:
                raise WizardError(
                    "Klipper did not report a valid rotation_distance",
                    message_key="ui.klipper_did_not_report_a_valid_rotation_distance",
                )
            self.session = WizardSession(
                id=secrets.token_urlsafe(16),
                state=WizardState.IDLE,
                mark_distance=mark_distance,
                commanded_extrusion=commanded_extrusion,
                extruder=snapshot.extruder,
                old_rotation_distance=snapshot.rotation_distance,
            )
            if self.config:
                try:
                    found = self.config.find(snapshot.extruder, "rotation_distance")
                    self.session.config_source = str(found.source)
                except ConfigError:
                    self.session.config_source = None
            return self.session

    async def heat(self, temperature: float) -> WizardSession:
        session = self._require(WizardState.IDLE, WizardState.HEATING)
        snapshot = await self._safe_snapshot()
        minimum = max(snapshot.min_extrude_temp, 150.0)
        if temperature < minimum or temperature > 300:
            raise WizardError(
                f"Temperature must be between {minimum:.0f} and 300 °C",
                message_key="ui.temperature_must_be_between_value_and_300_c",
                message_params={"minimum": format(minimum, ".0f")},
            )
        if abs(temperature / 5 - round(temperature / 5)) > 1e-9:
            raise WizardError(
                "Temperature must be selected in 5 °C increments",
                message_key="ui.temperature_must_be_selected_in_5_c_increments",
            )
        await self.printer.heat(session.extruder, temperature)
        session.state = WizardState.HEATING
        return session

    async def ready(self) -> WizardSession:
        session = self._require(WizardState.HEATING, WizardState.READY)
        snapshot = await self._safe_snapshot()
        if not snapshot.can_extrude or snapshot.temperature < snapshot.min_extrude_temp:
            raise WizardError(
                "The hotend has not reached a safe extrusion temperature",
                message_key="ui.the_hotend_has_not_reached_a_safe_extrusion_temperature",
            )
        session.state = WizardState.READY
        return session

    async def extrude(self, *, verification: bool = False) -> WizardSession:
        allowed = (WizardState.APPLIED,) if verification else (WizardState.READY,)
        session = self._require(*allowed)
        snapshot = await self._safe_snapshot()
        if not snapshot.can_extrude or snapshot.temperature < snapshot.min_extrude_temp:
            raise WizardError(
                "Cold extrusion protection is active",
                message_key="ui.cold_extrusion_protection_is_active",
            )
        session.state = WizardState.VERIFYING if verification else WizardState.RUNNING
        try:
            await self.printer.extrude(
                session.extruder, session.commanded_extrusion, session.extrusion_speed
            )
        except PrinterError as exc:
            session.state = WizardState.ERROR
            session.error = str(exc)
            session.error_key = exc.message_key
            session.error_params = exc.message_params
            raise WizardError(exc) from exc
        if not verification:
            session.state = WizardState.WAITING_FOR_MEASUREMENT
        return session

    async def measurement(
        self, remaining_distance: float, *, verification: bool = False
    ) -> WizardSession:
        allowed = (
            (WizardState.VERIFYING,) if verification else (WizardState.WAITING_FOR_MEASUREMENT,)
        )
        session = self._require(*allowed)
        try:
            result = calculate_rotation_distance(
                session.old_rotation_distance
                if not verification
                else session.result.new_rotation_distance,
                session.mark_distance,
                session.commanded_extrusion,
                remaining_distance,
            )
        except (ValidationError, AttributeError) as exc:
            raise WizardError(exc) from exc
        if verification:
            session.verification_result = result
            session.state = WizardState.COMPLETE
        else:
            session.result = result
            session.state = WizardState.CALCULATED
        return session

    async def apply(self) -> WizardSession:
        session = self._require(WizardState.CALCULATED)
        if not session.result or not session.result.safe_to_apply:
            raise WizardError(
                "Plausibility warnings must be resolved by measuring again",
                message_key="ui.plausibility_warnings_must_be_resolved_by_measuring_again",
            )
        await self._safe_snapshot()
        await self.printer.set_rotation_distance(
            session.extruder, session.result.new_rotation_distance
        )
        session.state = WizardState.APPLIED
        session.save_token = secrets.token_urlsafe(24)
        return session

    async def measure_again(self) -> WizardSession:
        session = self._require(WizardState.CALCULATED, WizardState.APPLIED)
        session.result = None
        session.save_token = None
        session.state = WizardState.READY
        return session

    async def save(
        self, token: str, old_value: float, new_value: float
    ) -> tuple[WizardSession, str]:
        session = self._require(WizardState.APPLIED, WizardState.COMPLETE)
        if not self.config:
            raise WizardError(
                "Permanent configuration writes are disabled",
                message_key="ui.permanent_configuration_writes_are_disabled",
            )
        if not session.result or not session.result.safe_to_apply:
            raise WizardError(
                "No safe result is available", message_key="ui.no_safe_result_is_available"
            )
        if not secrets.compare_digest(token, session.save_token or ""):
            raise WizardError(
                "Save confirmation token is invalid or expired",
                message_key="ui.save_confirmation_token_is_invalid_or_expired",
            )
        if abs(old_value - session.old_rotation_distance) > 1e-7:
            raise WizardError(
                "Old value confirmation does not match this session",
                message_key="ui.old_value_confirmation_does_not_match_this_session",
            )
        if abs(new_value - session.result.new_rotation_distance) > 1e-7:
            raise WizardError(
                "New value confirmation does not match this session",
                message_key="ui.new_value_confirmation_does_not_match_this_session",
            )
        await self._safe_snapshot()
        try:
            source, backup = self.config.update_rotation_distance(
                session.extruder,
                session.old_rotation_distance,
                session.result.new_rotation_distance,
            )
        except ConfigError as exc:
            raise WizardError(exc) from exc
        session.save_token = None
        session.state = WizardState.COMPLETE
        return session, Message(
            f"Updated {source}; backup: {backup}",
            "config.updated",
            source=str(source),
            backup=str(backup),
        )

    async def cancel(self) -> WizardSession:
        session = self._require(*tuple(WizardState))
        if session.state == WizardState.RUNNING:
            raise WizardError(
                "Cannot cancel while the synchronous extrusion command is running",
                message_key="ui.cannot_cancel_while_the_synchronous_extrusion_command_is_running",
            )
        if session.save_token and session.state in {WizardState.APPLIED, WizardState.COMPLETE}:
            await self._safe_snapshot()
            await self.printer.set_rotation_distance(
                session.extruder, session.old_rotation_distance
            )
        session.state = WizardState.CANCELLED
        session.save_token = None
        return session
