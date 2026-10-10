from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class WizardState(str, Enum):
    IDLE = "IDLE"
    HEATING = "HEATING"
    READY = "READY"
    RUNNING = "RUNNING"
    WAITING_FOR_MEASUREMENT = "WAITING_FOR_MEASUREMENT"
    CALCULATED = "CALCULATED"
    APPLIED = "APPLIED"
    VERIFYING = "VERIFYING"
    COMPLETE = "COMPLETE"
    ERROR = "ERROR"
    CANCELLED = "CANCELLED"


class PrinterSnapshot(BaseModel):
    connected: bool = True
    state: str = "ready"
    state_message: str = ""
    extruder: str = "extruder"
    temperature: float = 25.0
    target: float = 0.0
    bed_temperature: float = 25.0
    bed_target: float = 0.0
    can_extrude: bool = False
    min_extrude_temp: float = 170.0
    rotation_distance: float = 4.706
    max_extrude_only_distance: float = 50.0
    homed_axes: str = ""
    print_state: str = "standby"
    save_config_pending: bool = False
    save_config_pending_items: dict[str, Any] = Field(default_factory=dict)


class PrinterCapabilities(BaseModel):
    commands: list[str] = Field(default_factory=list)
    objects: list[str] = Field(default_factory=list)
    settings: list[str] = Field(default_factory=list)
    heaters: list[str] = Field(default_factory=list)

    def has_command(self, command: str) -> bool:
        return command.upper() in self.commands


class CalibrationSession(BaseModel):
    id: str
    wizard: str
    state: str = "READY"
    data: dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    save_token: Optional[str] = None


class CalibrationStartRequest(BaseModel):
    options: dict[str, Any] = Field(default_factory=dict)


class CalibrationActionRequest(BaseModel):
    action: str
    values: dict[str, Any] = Field(default_factory=dict)
    confirmation_token: Optional[str] = None


class SetupPreviewRequest(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)


class SetupSaveRequest(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)
    confirmation_token: str
    restart: bool = True


class CalibrationResult(BaseModel):
    requested_extrusion: float
    actual_extrusion: float
    deviation_mm: float
    deviation_percent: float
    old_rotation_distance: float
    new_rotation_distance: float
    warnings: list[str] = Field(default_factory=list)
    safe_to_apply: bool


class WizardSession(BaseModel):
    id: str
    state: WizardState = WizardState.IDLE
    mark_distance: float = 120.0
    commanded_extrusion: float = 100.0
    extrusion_speed: float = 1.0
    extruder: str = "extruder"
    old_rotation_distance: float
    result: Optional[CalibrationResult] = None
    verification_result: Optional[CalibrationResult] = None
    error: Optional[str] = None
    save_token: Optional[str] = None
    config_source: Optional[str] = None


class StartRequest(BaseModel):
    mark_distance: float = 120.0
    commanded_extrusion: float = 100.0


class HeatRequest(BaseModel):
    temperature: float


class FilamentHeatRequest(BaseModel):
    temperature: float = Field(ge=0, le=300, allow_inf_nan=False)


class FilamentMoveRequest(BaseModel):
    distance: float = Field(default=50, gt=0, le=500, allow_inf_nan=False)
    speed: float = Field(default=2, gt=0, le=5, allow_inf_nan=False)


class MeasurementRequest(BaseModel):
    remaining_distance: float


class SaveRequest(BaseModel):
    confirmation_token: str
    old_rotation_distance: float
    new_rotation_distance: float


class ApiError(BaseModel):
    detail: str
    code: str = "wizard_error"
    context: dict[str, Any] = Field(default_factory=dict)
