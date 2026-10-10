from __future__ import annotations

import asyncio
import math
from abc import ABC, abstractmethod
from typing import Any

import httpx

from .models import PrinterCapabilities, PrinterSnapshot


class PrinterError(RuntimeError):
    pass


class PrinterAdapter(ABC):
    @abstractmethod
    async def snapshot(self) -> PrinterSnapshot: ...

    @abstractmethod
    async def heat(self, extruder: str, temperature: float) -> None: ...

    @abstractmethod
    async def extrude(self, extruder: str, distance: float, speed: float) -> None: ...

    @abstractmethod
    async def set_rotation_distance(self, extruder: str, distance: float) -> None: ...

    @abstractmethod
    async def restart(self) -> None: ...

    @abstractmethod
    async def emergency_stop(self) -> None: ...

    @abstractmethod
    async def capabilities(self) -> PrinterCapabilities: ...

    @abstractmethod
    async def run_gcode(self, script: str, *, long_running: bool = False) -> None: ...

    @abstractmethod
    async def query_objects(self, objects: dict[str, list[str] | None]) -> dict[str, Any]: ...


class MoonrakerPrinter(PrinterAdapter):
    def __init__(self, base_url: str, api_key: str | None = None, timeout: float = 15.0):
        headers = {"X-Api-Key": api_key} if api_key else {}
        self.client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"), headers=headers, timeout=timeout
        )

    async def _result(self, response: httpx.Response) -> Any:
        response.raise_for_status()
        payload = response.json()
        if "error" in payload:
            raise PrinterError(str(payload["error"].get("message", payload["error"])))
        return payload.get("result", payload)

    async def snapshot(self) -> PrinterSnapshot:
        try:
            info, objects = await asyncio.gather(
                self.client.get("/printer/info"),
                self.client.post(
                    "/printer/objects/query",
                    json={
                        "objects": {
                            "webhooks": ["state", "state_message"],
                            "extruder": ["temperature", "target", "can_extrude"],
                            "configfile": [
                                "settings",
                                "save_config_pending",
                                "save_config_pending_items",
                            ],
                            "toolhead": ["homed_axes", "extruder"],
                            "print_stats": ["state"],
                        }
                    },
                ),
            )
            info_result = await self._result(info)
            object_result = await self._result(objects)
        except (httpx.HTTPError, ValueError) as exc:
            return PrinterSnapshot(connected=False, state="disconnected", state_message=str(exc))

        status = object_result.get("status", {})
        webhooks = status.get("webhooks", {})
        toolhead = status.get("toolhead", {})
        extruder_name = toolhead.get("extruder", "extruder")
        extruder_status = status.get(extruder_name, status.get("extruder", {}))
        if extruder_name != "extruder" and extruder_name not in status:
            try:
                active_response = await self.client.post(
                    "/printer/objects/query",
                    json={"objects": {extruder_name: ["temperature", "target", "can_extrude"]}},
                )
                active_result = await self._result(active_response)
                extruder_status = active_result.get("status", {}).get(extruder_name, {})
            except (httpx.HTTPError, ValueError):
                extruder_status = {}
        settings = status.get("configfile", {}).get("settings", {})
        bed_status: dict[str, Any] = {}
        if "heater_bed" in settings:
            try:
                bed_response = await self.client.post(
                    "/printer/objects/query",
                    json={"objects": {"heater_bed": ["temperature", "target"]}},
                )
                bed_result = await self._result(bed_response)
                bed_status = bed_result.get("status", {}).get("heater_bed", {})
            except (httpx.HTTPError, ValueError):
                bed_status = {}
        extruder_settings = settings.get(extruder_name, settings.get("extruder", {}))
        state = webhooks.get("state", info_result.get("state", "unknown"))
        return PrinterSnapshot(
            connected=True,
            state=state,
            state_message=webhooks.get("state_message", info_result.get("state_message", "")),
            extruder=extruder_name,
            temperature=float(extruder_status.get("temperature", 0)),
            target=float(extruder_status.get("target", 0)),
            bed_temperature=float(bed_status.get("temperature", 0)),
            bed_target=float(bed_status.get("target", 0)),
            can_extrude=bool(extruder_status.get("can_extrude", False)),
            min_extrude_temp=float(extruder_settings.get("min_extrude_temp", 170)),
            rotation_distance=float(extruder_settings.get("rotation_distance", 0)),
            max_extrude_only_distance=float(extruder_settings.get("max_extrude_only_distance", 50)),
            homed_axes=toolhead.get("homed_axes", ""),
            print_state=status.get("print_stats", {}).get("state", "standby"),
            save_config_pending=bool(
                status.get("configfile", {}).get("save_config_pending", False)
            ),
            save_config_pending_items=status.get("configfile", {}).get(
                "save_config_pending_items", {}
            ),
        )

    async def _gcode(self, script: str, *, long_running: bool = False) -> None:
        try:
            response = await self.client.post(
                "/printer/gcode/script",
                json={"script": script},
                timeout=None if long_running else self.client.timeout,
            )
            await self._result(response)
        except (httpx.HTTPError, ValueError) as exc:
            raise PrinterError(str(exc)) from exc

    async def run_gcode(self, script: str, *, long_running: bool = False) -> None:
        await self._gcode(script, long_running=long_running)

    async def query_objects(self, objects: dict[str, list[str] | None]) -> dict[str, Any]:
        try:
            response = await self.client.post("/printer/objects/query", json={"objects": objects})
            result = await self._result(response)
            return result.get("status", {})
        except (httpx.HTTPError, ValueError) as exc:
            raise PrinterError(str(exc)) from exc

    async def capabilities(self) -> PrinterCapabilities:
        try:
            listed, help_response, config_response = await asyncio.gather(
                self.client.get("/printer/objects/list"),
                self.client.get("/printer/gcode/help"),
                self.client.post(
                    "/printer/objects/query", json={"objects": {"configfile": ["settings"]}}
                ),
            )
            object_result = await self._result(listed)
            help_result = await self._result(help_response)
            config_result = await self._result(config_response)
        except (httpx.HTTPError, ValueError):
            return PrinterCapabilities()
        objects = object_result.get("objects", [])
        command_map = help_result.get("gcode_commands", help_result)
        commands = sorted(str(item).upper() for item in command_map)
        settings = config_result.get("status", {}).get("configfile", {}).get("settings", {})
        heaters = sorted(name for name in settings if name.startswith("extruder"))
        if "heater_bed" in settings:
            heaters.append("heater_bed")
        heaters.extend(sorted(name for name in settings if name.startswith("heater_generic ")))
        return PrinterCapabilities(
            commands=commands,
            objects=sorted(objects),
            settings=sorted(settings),
            heaters=heaters,
        )

    async def heat(self, extruder: str, temperature: float) -> None:
        await self._gcode(f"SET_HEATER_TEMPERATURE HEATER={extruder} TARGET={temperature:.1f}")

    async def extrude(self, extruder: str, distance: float, speed: float) -> None:
        snapshot = await self.snapshot()
        if not snapshot.connected or snapshot.state != "ready" or not snapshot.can_extrude:
            raise PrinterError("Klipper is not ready for a safe extrusion")
        if snapshot.print_state in {"printing", "paused"} or snapshot.extruder != extruder:
            raise PrinterError("Active extruder changed or printer is busy")
        if not math.isfinite(distance) or not math.isfinite(speed) or speed <= 0:
            raise PrinterError("Invalid extrusion distance or speed")
        chunk = min(snapshot.max_extrude_only_distance, 50.0)
        if not math.isfinite(chunk) or chunk <= 0:
            raise PrinterError("Invalid max_extrude_only_distance reported by Klipper")
        moves: list[float] = []
        remaining = abs(distance)
        while remaining > 1e-6:
            moves.append(min(chunk, remaining))
            remaining -= moves[-1]
        feedrate = speed * 60
        direction = -1 if distance < 0 else 1
        move_gcode = "\n".join(f"G1 E{direction * part:.5f} F{feedrate:.1f}" for part in moves)
        script = (
            "SAVE_GCODE_STATE NAME=calibration_wizard_extrusion\n"
            "M83\n"
            f"{move_gcode}\n"
            "M400\n"
            "RESTORE_GCODE_STATE NAME=calibration_wizard_extrusion MOVE=0"
        )
        await self._gcode(script, long_running=True)

    async def set_rotation_distance(self, extruder: str, distance: float) -> None:
        if not math.isfinite(distance) or distance <= 0:
            raise PrinterError("Invalid rotation distance")
        await self._gcode(
            f"SET_EXTRUDER_ROTATION_DISTANCE EXTRUDER={extruder} DISTANCE={distance:.8f}"
        )

    async def restart(self) -> None:
        await self._gcode("RESTART")

    async def emergency_stop(self) -> None:
        response = await self.client.post("/printer/emergency_stop")
        await self._result(response)


class MockPrinter(PrinterAdapter):
    def __init__(self) -> None:
        self.data = PrinterSnapshot()
        self.heating_rate = 80.0
        self.extrusions: list[float] = []
        self.gcodes: list[str] = []
        self.capability_data = PrinterCapabilities(
            commands=[
                "PID_CALIBRATE",
                "BED_MESH_CALIBRATE",
                "SCREWS_TILT_CALCULATE",
                "BED_SCREWS_ADJUST",
                "Z_TILT_ADJUST",
                "QUAD_GANTRY_LEVEL",
                "PROBE_CALIBRATE",
                "TESTZ",
                "ACCEPT",
                "ABORT",
                "SET_PRESSURE_ADVANCE",
                "TUNING_TOWER",
                "SHAPER_CALIBRATE",
                "ACCELEROMETER_QUERY",
                "MEASURE_AXES_NOISE",
            ],
            objects=[
                "bed_mesh",
                "screws_tilt_adjust",
                "bed_screws",
                "z_tilt",
                "quad_gantry_level",
                "probe",
                "resonance_tester",
            ],
            settings=[
                "extruder",
                "heater_bed",
                "bed_mesh",
                "screws_tilt_adjust",
                "bed_screws",
                "z_tilt",
                "quad_gantry_level",
                "probe",
                "resonance_tester",
            ],
            heaters=["extruder", "heater_bed"],
        )

    async def snapshot(self) -> PrinterSnapshot:
        if self.data.connected and self.data.temperature < self.data.target:
            self.data.temperature = min(self.data.target, self.data.temperature + self.heating_rate)
        self.data.can_extrude = (
            self.data.connected
            and self.data.state == "ready"
            and self.data.temperature >= self.data.min_extrude_temp
        )
        return self.data.model_copy(deep=True)

    async def heat(self, extruder: str, temperature: float) -> None:
        self.data.target = temperature

    async def extrude(self, extruder: str, distance: float, speed: float) -> None:
        if not (await self.snapshot()).can_extrude:
            raise PrinterError("Mock hotend is not ready to extrude")
        self.extrusions.append(distance)
        await asyncio.sleep(0)

    async def set_rotation_distance(self, extruder: str, distance: float) -> None:
        self.data.rotation_distance = distance

    async def restart(self) -> None:
        self.data.state = "ready"
        self.data.homed_axes = ""
        self.data.save_config_pending = False
        self.data.save_config_pending_items = {}

    async def emergency_stop(self) -> None:
        self.data.state = "shutdown"
        self.data.state_message = "Emergency stop triggered"
        self.data.target = 0.0
        self.data.bed_target = 0.0

    async def run_gcode(self, script: str, *, long_running: bool = False) -> None:
        self.gcodes.append(script)
        if script == "G28":
            self.data.homed_axes = "xyz"
        if script == "SAVE_CONFIG":
            self.data.save_config_pending = False
            self.data.save_config_pending_items = {}

    async def query_objects(self, objects: dict[str, list[str] | None]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        if "bed_mesh" in objects:
            result["bed_mesh"] = {"profile_name": "default", "probed_matrix": [[0.0]]}
        if "screws_tilt_adjust" in objects:
            result["screws_tilt_adjust"] = {"error": False, "max_deviation": 0.02, "results": {}}
        if "toolhead" in objects:
            result["toolhead"] = {"max_accel": 3000.0, "square_corner_velocity": 5.0}
        if "configfile" in objects:
            result["configfile"] = {"settings": {"extruder": {"pressure_advance": 0.0}}}
        return result

    async def capabilities(self) -> PrinterCapabilities:
        return self.capability_data.model_copy(deep=True)

    def simulate(self, *, state: str | None = None, connected: bool | None = None) -> None:
        if state is not None:
            self.data.state = state
        if connected is not None:
            self.data.connected = connected
