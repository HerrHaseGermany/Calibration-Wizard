# Changelog

## 0.1.1

- Ensure rerunning the installer restarts an already active Wizard service so newly installed code is loaded immediately.

## 0.1.0

- Added separate Moonraker-backed service and responsive web UI.
- Added full extruder calibration state machine, runtime apply, verification, and confirmed persistence.
- Added include-aware atomic configuration backups and restore documentation.
- Added mock printer, test suite, systemd/nginx installer, uninstaller, and Moonraker Update Manager integration.
- Added a Git-native deployment path with automatic origin and branch detection for updates through Moonraker-compatible clients such as Obico.
