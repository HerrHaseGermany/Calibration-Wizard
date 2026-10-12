# Klipper Calibration Wizard

A safety-first, modular calibration center for Klipper printers. It guides users through calibration in a responsive web interface while Moonraker remains the supported boundary to Klipper.

> **Development status:** active development. Use the mock mode freely and run hardware
> calibration only on a supervised printer.

<!-- Screenshot placeholder: dashboard -->
<!-- Screenshot placeholder: extruder result and confirmation -->

## Features

- Helper tools: guided filament loading, unloading, and changing with material temperature presets and confirmation after heating. Loading extrudes 100 mm then retracts 2 mm; unloading extrudes 5 mm before retracting 100 mm. Filament changing unloads first, then loads at the chosen new material temperature. Movement progress follows completed extrusion chunks. Done switches the hotend off; a separate finish option keeps it heated. Filament movement is blocked while cold, printing, paused, or calibrating.
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
- Standalone service and UI, plus a small checked Mainsail patch for a native Tools page. Klipper and Moonraker source files remain untouched.
- Systemd, nginx `/tools/`, and current Moonraker `git_repo` Update Manager integration.
- German and English UI, selected automatically from the preferred browser languages (System / Browser), with a persistent manual override.

## Requirements

- A Debian-family Klipper host with Python 3.9+, systemd, Git, Moonraker, and Klipper.
- Mainsail **2.19.0** for the native Tools tab. This is currently the only checked release; other releases are not automatically patched.
- Node.js **22.12+ (22.x recommended)**, or 20.19+ (20.x), plus npm, Git and zip to build the Mainsail extension. Node.js must also be available to the systemd build service.
- nginx for `/tools/` routing. Fluidd or custom proxies can use the documented manual route.
- SSH/sudo access for installation.

The code makes no assumptions about MCU, control board, kinematics, or printer brand. v0.1 calibrates the primary Klipper extruder; multi-extruder hardware still requires real-printer validation.

## Install

### Prepare the host and install Node.js

Run these commands over SSH **on the printer host**, before running the installer. Klipper, Moonraker and Mainsail must already be installed.

Install the required Debian/Ubuntu/Armbian packages:

```bash
sudo apt update
sudo apt install -y python3 python3-venv git curl ca-certificates zip
```

Check whether a suitable Node.js and npm are already installed:

```bash
node --version
npm --version
```

If Node.js is missing or too old, install Node.js 22 system-wide using the [NodeSource Debian installation instructions](https://github.com/nodesource/distributions). This method supports **arm64** hosts such as the BIGTREETECH CB2 and **amd64** hosts:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/klipper-tools-nodesource-setup.sh
sudo bash /tmp/klipper-tools-nodesource-setup.sh
sudo apt install -y nodejs
node --version
npm --version
```

The NodeSource `nodejs` package includes npm. The Node.js version should be `v22.12.0` or newer within the 22.x series. Use a system-wide installation so the background build service can find Node.js and npm; a shell-only installation through nvm requires a suitable `KCW_BUILD_PATH` as described in [the installation guide](docs/INSTALLATION.md).

### Install Klipper Tools

```bash
cd ~
git clone https://github.com/HerrHaseGermany/Calibration-Wizard.git
cd Calibration-Wizard
./install.sh
```

Then open `http://<printer>/tools/`. The independent UI and Repair action remain available at `http://<printer>/api/klipper-tools/`. See [the installation guide](docs/INSTALLATION.md) for nonstandard paths, authentication, update behavior, backups, restore, and troubleshooting.

The installer automatically configures the Tools service, nginx routes and Mainsail extension for the standard layout. The extension builds in the background; allow several minutes on a small printer host. Wait for the build to finish, then reload Mainsail to see the Tools tab. It includes preloading, Mainsail theme/language synchronization, the responsive layout and content-based frame height without additional UI configuration. Build status and Repair are available in the independent UI; inspect build logs with:

```bash
journalctl -u klipper-tools-mainsail-repair.service -n 100 --no-pager
```

## Update and uninstall

Moonraker Update Manager configuration is managed manually. The installer does not create an update-manager config file or add an include to `moonraker.conf`.

Add the following section to your existing update-manager config (already included by `moonraker.conf`), or directly to `moonraker.conf`. If you already have an entry for this tool, adapt it rather than adding a duplicate.

```ini
[update_manager klipper-calibration-wizard]
type: git_repo
channel: dev
path: ~/Calibration-Wizard
origin: https://github.com/HerrHaseGermany/Calibration-Wizard.git
primary_branch: main
virtualenv: ~/Calibration-Wizard/.venv
requirements: requirements.txt
managed_services: klipper-calibration-wizard
info_tags:
  desc=Klipper Calibration Wizard
```

Adjust `path` and `virtualenv` to your installation directory, and `origin` and `primary_branch` to your checkout. Check these values with `pwd`, `git remote get-url origin`, and `git branch --show-current` from the repository. The `dev` channel follows commits on the configured branch. The installer adds the service to `~/printer_data/moonraker.asvc` so Moonraker can restart it after updates. See the [Moonraker configuration reference](https://moonraker.readthedocs.io/en/latest/configuration/#git-repo-configuration) for available options.

After saving, restart Moonraker:

```bash
sudo systemctl restart moonraker.service
```

For installations made with an older installer, first move the section from `~/printer_data/config/klipper-calibration-wizard-update.conf` into your own config, unless it is already present there. Then remove `[include klipper-calibration-wizard-update.conf]` from `moonraker.conf` and delete the old file before restarting Moonraker. Keep exactly one `[update_manager klipper-calibration-wizard]` section. Existing files are not automatically changed or removed.

For a manual checkout update use `git pull --ff-only && ./update.sh`.

Run `./uninstall.sh` to remove the service and integration. Remove the Wizard's update-manager section from your own Moonraker config manually and restart Moonraker afterwards. The uninstaller retains user data and backups and never removes foreign Klipper configuration.

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
wizards. The installer builds the checked Mainsail release with a native **Tools** route at
`/tools/`. Its main content embeds the Wizard while retaining Mainsail's sidebar and topbar.
The independent UI stays available at `/api/klipper-tools/`; old `/calibration/` links redirect
there. If Mainsail overwrites the extension, its files are detected as missing or changed and
the standalone UI offers **Repair** for a supported release. Unknown releases are reported
without deploying an unchecked patch. See [Mainsail integration](docs/MAINSAIL-INTEGRATION.md).

## Troubleshooting

Start with `journalctl -u klipper-calibration-wizard -n 100 --no-pager` and `/api/status`. A save refusal is intentional when the source include cannot be identified safely. More commands and recovery guidance are in [docs/INSTALLATION.md](docs/INSTALLATION.md).

On an existing printer, rerun `./install.sh` after updating to install the new nginx routes
and the repair service. A package update alone cannot install these system integrations.
