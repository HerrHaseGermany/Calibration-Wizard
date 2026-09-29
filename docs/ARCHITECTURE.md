# Architecture

## Decision summary

Klipper Calibration Wizard is a separate, loopback-bound service. It talks to Klipper only through Moonraker's documented HTTP API and exposes its own REST and WebSocket API plus a static web client. Nginx maps the application to `/calibration/`; Mainsail and Fluidd source files remain untouched.

A Moonraker in-process component was rejected for v0.1. Such a component would couple releases to Moonraker internals and failure lifecycle, while the supported external API already supplies printer objects, G-code execution, connection state, and live event semantics. An external service also gives calibration code a separate virtual environment, process boundary, test harness, and update entry. A future agent connection may improve event delivery but is not required for printer control.

## Components

```text
Browser /calibration/
  │ REST commands + WebSocket status
  ▼
Calibration Wizard service (127.0.0.1:7130)
  ├─ API and same-origin boundary
  ├─ wizard registry / manifests
  ├─ per-wizard state machine
  ├─ calculation and validation domain
  ├─ PrinterAdapter ───────► Moonraker HTTP API ─► Klipper
  └─ ConfigRepository ────► exact originating Klipper include
```

The browser never sends G-code, calculates an authoritative value, or writes a configuration file. It requests transitions. The backend checks the current state, queries the printer immediately before motion, and owns all calculations.

## Printer boundary

`PrinterAdapter` is the hardware abstraction. `MoonrakerPrinter` uses these documented endpoints:

- `GET /printer/info`
- `POST /printer/objects/query`
- `POST /printer/gcode/script`

`MockPrinter` provides the same contract without hardware. The production adapter uses `SET_HEATER_TEMPERATURE`, state-preserving relative extrusion, and `SET_EXTRUDER_ROTATION_DISTANCE`. The latter is explicitly documented by Klipper as a runtime-only change.

## Why `SAVE_CONFIG` is not used

Klipper documents `SAVE_CONFIG` for values that a calibration command places in its pending save set. `SET_EXTRUDER_ROTATION_DISTANCE` explicitly does not persist over a reset and does not register an arbitrary `rotation_distance` for `SAVE_CONFIG`. Calling `SAVE_CONFIG` would therefore be misleading and could also save unrelated pending calibration data.

For permanent storage the local `KlipperConfigRepository` resolves `[include ...]` directives, including common external vendor symlinks, and requires exactly one source setting. External includes are read only for origin and duplicate detection; only files physically inside the Klipper configuration root are writable. It creates a timestamped backup, verifies that the expected old value is still present, and atomically replaces only that parsed setting. Ambiguity, expressions, missing includes, and concurrent changes fail closed. Klipper/Moonraker/Mainsail source code is never modified.

## Extrusion safety

The backend requires a connected `ready` Klipper and `can_extrude=true` immediately before movement. It also compares actual and minimum temperatures. The default 100 mm request exceeds Klipper's default `max_extrude_only_distance` of 50 mm, so it is emitted as multiple moves no larger than the configured limit inside `SAVE_GCODE_STATE` / `M83` / `M400` / `RESTORE_GCODE_STATE`.

The service keeps one current session per calibration type. A process restart invalidates all
sessions and confirmation tokens. Hardware actions require a connected, ready, idle printer.
Long-running Moonraker requests have no artificial 15-second client timeout. A request already
executing in Klipper cannot be cancelled retroactively; the UI therefore never claims that an
in-flight hardware command was stopped. Pressure Advance restores temporary velocity limits when
the result is applied or the workflow is cancelled.

## Live status

The browser receives one WebSocket stream from the Wizard service. In v0.1 the production adapter refreshes Moonraker status once per second. A direct Moonraker subscription adapter is the next optimization; the frontend API will not change.

## Extension model

Each wizard owns a manifest under `wizards/<id>/manifest.json`, domain logic, transition rules, validation, and API handler. Shared code contains printer/configuration boundaries, not calibration-specific formulas. See [WIZARD_DEVELOPMENT.md](WIZARD_DEVELOPMENT.md).

Leveling is capability-driven rather than tied to printer models. Klipper's live object, command,
and settings lists determine whether `bed_screws`, `screws_tilt_adjust`, `z_tilt`, or
`quad_gantry_level` is available. Coordinate collections are variable-length where Klipper permits
it. Setup writes only schema-approved keys in the relevant section, preserves unrelated keys,
removes obsolete numbered screw entries, verifies that the config tree has not changed since the
preview, creates a backup, and restarts only after explicit confirmation.

## Upstream references reviewed

- [Klipper rotation distance](https://www.klipper3d.org/Rotation_Distance.html)
- [Klipper G-Codes](https://www.klipper3d.org/G-Codes.html)
- [Klipper measuring resonance](https://www.klipper3d.org/Measuring_Resonances.html)
- [Klipper pressure advance](https://www.klipper3d.org/Pressure_Advance.html)
- [Klipper probe calibration](https://www.klipper3d.org/Probe_Calibrate.html)
- [Klipper bed mesh](https://www.klipper3d.org/Bed_Mesh.html)
- [Klipper configuration reference](https://www.klipper3d.org/Config_Reference.html)
- [Moonraker external API](https://moonraker.readthedocs.io/en/latest/external_api/introduction/)
- [Moonraker printer API](https://moonraker.readthedocs.io/en/latest/external_api/printer/)
- [Moonraker update-manager configuration](https://moonraker.readthedocs.io/en/latest/configuration/)
- [Mainsail manual nginx setup](https://docs.mainsail.xyz/setup/getting-started/manual-setup)
