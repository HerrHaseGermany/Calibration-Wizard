# Klipper Calibration Wizard

A safety-first, modular calibration center for Klipper printers. It guides users through calibration in a responsive web interface while Moonraker remains the supported boundary to Klipper.

> **Development status:** active development. Use the mock mode freely and run hardware
> calibration only on a supervised printer.

<!-- Screenshot placeholder: dashboard -->
<!-- Screenshot placeholder: extruder result and confirmation -->

## Features

- Quality of life tools: heat the hotend, load or unload filament with adjustable length and speed, and switch the heater off. Filament movement is blocked while cold, printing, paused, or calibrating.
- Complete extruder `rotation_distance` workflow: discovery, heating, marking, controlled extrusion, measurement, calculation, plausibility check, runtime apply, optional verification, backup, and explicit save.
- Guided PID, flow, pressure advance, probe Z-offset, screws tilt, bed mesh, and input-shaper workflows.
- Downloadable 30 × 30 × 20 mm STL test model and slicer settings for the flow workflow.
- Adaptive leveling for manual `bed_screws`, probe-based `screws_tilt_adjust`, multi-Z
  `z_tilt`, and four-motor `quad_gantry_level`; point counts come from each printer's config.
- Setup assistants for mesh bounds and grid, screw coordinates, Z actuator locations, probe
  points, and gantry corners, with preview, stale-config protection, backup, and explicit restart.
- Dynamic capability discovery: unsupported workflows stay visible with a concrete reason and activate automatically when their Klipper requirements are installed.
- Long-running Moonraker operations without a short HTTP timeout, with print-state, homing, capability, and pending-configuration guards.
- Server-owned state machine and validation; the browser never emits raw G-code.
- Automatic current `rotation_distance`, temperature, `min_extrude_temp`, active extruder, and extrusion-limit discovery.
- Include-aware Klipper configuration source resolution with compare-before-write and atomic replacement.
- Live browser status over WebSocket.
- Hardware-independent mock printer.
- Standalone service and UI; no patches to Klipper, Moonraker, Mainsail, or Fluidd.
- Systemd, nginx `/calibration/`, and current Moonraker `git_repo` Update Manager integration.
- German and English UI, selected from the browser language with a persistent manual switch.

## Requirements

- A Debian-family Klipper host with Python 3.9+, systemd, Git, Moonraker, and Klipper.
- Mainsail/nginx for automatic `/calibration/` routing. Fluidd or custom proxies can use the documented manual route.
- SSH/sudo access for installation.

The code makes no assumptions about MCU, control board, kinematics, or printer brand. v0.1 calibrates the primary Klipper extruder; multi-extruder hardware still requires real-printer validation.

## Install

```bash
git clone https://github.com/HerrHaseGermany/Calibration-Wizard.git
cd Calibration-Wizard
./install.sh
```

Then open `http://<printer>/calibration/`. See [the installation guide](docs/INSTALLATION.md) for nonstandard paths, authentication, update behavior, backups, restore, and troubleshooting.

## Update and uninstall

The installer registers **klipper-calibration-wizard** with Moonraker's Update Manager. For a manual checkout update use `git pull --ff-only && ./update.sh`.

Run `./uninstall.sh` to remove the service and integration. It deliberately retains user data and backups and never removes foreign Klipper configuration.

## Configuration

Runtime settings live in:

```text
~/printer_data/config/.klipper-calibration-wizard/service.env
```

Important variables are `KCW_MOONRAKER_URL`, optional `KCW_MOONRAKER_API_KEY`, `KCW_KLIPPER_CONFIG`, and `KCW_BACKUP_DIR`. Restart `klipper-calibration-wizard` after editing.

## Development without a printer

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
KCW_MOCK=true .venv/bin/klipper-calibration-wizard
```

Open <http://127.0.0.1:7130/>. The mock simulates ready state, heating, extrusion, runtime rotation distance, shutdown, and disconnection through its adapter API. No real G-code is sent.

Run quality checks:

```bash
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/pytest
```

## Safety

Keep the printer supervised during calibration. Confirm that the chosen temperature matches the loaded material and that filament can move freely. The Wizard checks Klipper state and cold-extrusion protection, but software cannot detect every jam, mechanical obstruction, incorrect thermistor, or wiring fault. Use the primary printer UI's emergency stop if needed.

Permanent writes are never automatic. The Wizard requires a fresh confirmation token. Direct
configuration edits create a timestamped backup and reject ambiguous sources; Klipper-native
calibrations expose a separate, explicit `SAVE_CONFIG` step. Read the full
[security model](docs/SECURITY.md).

## Architecture and contributing

- [Architecture and upstream API decisions](docs/ARCHITECTURE.md)
- [Wizard development contract](docs/WIZARD_DEVELOPMENT.md)
- [Installation and restore](docs/INSTALLATION.md)

The existing MIT license was retained. Contributions should include domain tests and failure-state coverage for every new hardware action.

## Calibration availability

The API evaluates the live Klipper command list, object list, and configuration on every dashboard
load. Input Shaper requires both `[resonance_tester]` and the commands `MEASURE_AXES_NOISE` and
`SHAPER_CALIBRATE`. Its card remains visible but disabled until those requirements are present.

Future work includes calibration history, printer profiles, first-layer analysis, and community
wizards. The installer adds an update-safe **Calibration** entry to Mainsail's sidebar through its
supported `.theme/navi.json` extension. Existing custom navigation entries are preserved, and the
standalone wizard remains available at `/calibration/`.

## Troubleshooting

Start with `journalctl -u klipper-calibration-wizard -n 100 --no-pager` and `/api/status`. A save refusal is intentional when the source include cannot be identified safely. More commands and recovery guidance are in [docs/INSTALLATION.md](docs/INSTALLATION.md).
