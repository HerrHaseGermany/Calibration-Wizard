# Installation

## Supported layout

The installer targets a normal Debian-based Klipper host using systemd and the common `~/printer_data` layout used by MainsailOS and current Moonraker installations. It builds a small checked Mainsail extension in a temporary checkout and installs the resulting frontend. Klipper source code stays untouched.

```bash
cd ~
git clone https://github.com/HerrHaseGermany/Calibration-Wizard.git
cd Calibration-Wizard
./install.sh
```

Run the installer from the Git checkout. Archive downloads are intentionally rejected because Moonraker can only update a real, branch-based Git repository. The script detects the checkout's `origin` and active branch, checks prerequisites, creates `.venv`, installs the Python package, installs and enables a hardened systemd unit, authorizes Moonraker to restart the service, adds a validated nginx `/tools/` route when the standard Mainsail site is found, and installs a dedicated Mainsail build/repair service. The old direct Tools sidebar link is removed; unrelated custom navigation entries are preserved and backed up before a change. The extension adds a native Tools route and builds in the background. Update-manager configuration is manual; the installer neither creates a separate update-manager file nor changes `moonraker.conf`.

Override nonstandard layouts with `KCW_DATA_DIR`, `KCW_CONFIG_DIR`, `KCW_MOONRAKER_CONFIG`, `KCW_KLIPPER_CONFIG`, `KCW_NGINX_SITE`, `KCW_MAINSAIL_NAVI`, `KCW_MAINSAIL_DIR` (default `~/mainsail`), `KCW_MAINSAIL_STATE_DIR` (default `~/printer_data/.klipper-tools-mainsail`, outside the watched config root), or `KCW_BUILD_PATH` (Node/npm executable search path).

Run `./install.sh --check` for a non-mutating preflight of interpreter and repository assets. It works on a development machine without Klipper; the actual installation remains Linux-only.

## Moonraker authorization

The backend connects to `http://127.0.0.1:7125`. Standard installations trust localhost. If yours requires an API key, add `KCW_MOONRAKER_API_KEY=<key>` to `~/printer_data/config/.klipper-calibration-wizard/service.env`, restrict that file to mode `0640`, and restart the service. Never commit this value.

## Nonstandard reverse proxy

If the installer cannot find `/etc/nginx/sites-available/mainsail`, copy the location blocks from `config/nginx-location.conf` into the relevant `server {}` block, run `sudo nginx -t`, and reload nginx. The trailing slash on `proxy_pass http://127.0.0.1:7130/;` is required.

## Updates through Obico or another Moonraker client

Obico uses Moonraker's Update Manager for Klipper installations. Add **klipper-calibration-wizard** to your own Moonraker update-manager configuration using the [example and migration instructions in the README](../README.md#update-and-uninstall). After a Moonraker restart, the entry is available to Obico and other compatible clients. Moonraker pulls the pristine Git checkout, updates Python requirements when necessary, and restarts the Wizard service. On startup, the service removes the obsolete direct Tools navigation entry, preserving other links and backing up changes. The native Tools menu belongs to the custom Mainsail build. After an upstream Mainsail update, open `/api/klipper-tools/` to inspect and repair it. `KCW_MAINSAIL_NAVI` overrides the default `.theme/navi.json` beside `KCW_KLIPPER_CONFIG`. `.venv`, backups, and service environment are ignored/untracked and user configuration is outside the checkout.

The `dev` update channel follows new commits on the installed branch. Releases are also tagged with semantic versions so clients can report a useful installed version. If local files in the checkout are edited, the Update Manager will report the repository as dirty; keep printer-specific settings in `~/printer_data`, not inside this repository.

After manual configuration or an update, verify the entry through Moonraker:

```bash
curl -s http://127.0.0.1:7125/machine/update/status | python3 -m json.tool
```

Manual update:

```bash
git pull --ff-only
./update.sh
```

## Restore a calibration backup

Backups are stored below `~/printer_data/backups/klipper-calibration-wizard/<UTC timestamp>/` with the same relative path as the source config. Stop printing, compare the backup and live file, copy the desired backup over its matching source file, then run `RESTART` from the printer UI. Never restore a whole directory blindly.

Installer backups of existing nginx or Mainsail navigation files use a leading dot. Older installers also created Moonraker and update-manager backups (for example `.moonraker.conf.kcw-backup-<timestamp>`). Mainsail hides these safety copies by default; enable its “show hidden files” option when a manual restore is required.

## Uninstall

```bash
./uninstall.sh
```

This stops/removes the Wizard and repair units, removes the Moonraker service authorization and nginx routes, and restores the frontend backup only if the currently installed extension is still intact. It never restores an older Mainsail version over an upstream update. Remove the Wizard's update-manager section from your own configuration manually, then restart Moonraker. Update-manager files and includes are left untouched. Calibration backups and the service environment are retained. No Klipper configuration or unrelated include is deleted.

## Troubleshooting

```bash
systemctl status klipper-calibration-wizard
journalctl -u klipper-calibration-wizard -n 100 --no-pager
curl http://127.0.0.1:7130/api/status
sudo nginx -t
```

If permanent saving is unavailable, inspect `config_source` in `/api/wizards/extruder`. External and symlinked includes may be read for origin detection, but the writer deliberately refuses to modify settings outside the Klipper config root. It also rejects duplicate sections/settings, computed values, unreadable files, and a value changed since the session began.

## Native Mainsail page and Repair

The checked patch currently supports **Mainsail 2.19.0**, pinned to its upstream commit.
Install Node.js **20.19+ (20.x)** or **22.12+**, npm, git, and zip before running the installer.
The standard target is `~/mainsail`; it must be writable by the printer user. If no Mainsail
frontend is detected, the installer keeps standalone operation and reports the missing target.

Rerun `./install.sh` on existing installations to install the new nginx routes and the
repair worker/path units. A Moonraker package update or `./update.sh` alone does not install
new systemd/nginx integrations. Perform installation while the printer is idle.

- `/tools/`: native Mainsail Tools page when the extension is intact; otherwise redirects
  to the independent UI.
- `/tools/app/`: the application embedded by Mainsail.
- `/api/klipper-tools/`: independent UI with automatic integrity checks and Repair status.
  This address is excluded by both the original and patched Mainsail service workers.
- `/tools/standalone/`: additional standalone alias; use the `/api/klipper-tools/` address
  for recovery if the original Mainsail service worker intercepts this alias.
- Old `/calibration/` paths and query strings redirect to the standalone UI.

The first build runs in the background. Status is polled every ten seconds. **Repair**
queues a job through a fixed local request file watched by systemd. The worker runs as the
printer user, checks the exact upstream commit, builds with the release's lockfile, checks
printer/Tools activity before deployment, backs up replaced files, and publishes assets
before the entry files. It rolls back if deployment fails. Printer-specific `config.json`
and unrelated custom files are preserved. The service has no Root privileges.

Missing or changed frontend files trigger a Repair notice; unsupported versions show a
compatibility notice with the standalone fallback. A new version becomes repairable only
after its patch is checked and added to the tool. Build failures are displayed in the UI;
logs are available with `journalctl -u klipper-tools-mainsail-repair -n 100 --no-pager`.

After a successful build, reload Mainsail. The patch excludes `/tools/` navigation from its
service worker fallback so the independent UI stays reachable. An older already-running
service worker may require closing/reopening Mainsail or a browser reload before it updates.
The installer does not unregister service workers or discard browser data.

Backups and build state are below `.klipper-calibration-wizard/mainsail/` beside the service
environment by default. Supply the same directory overrides when uninstalling a custom layout.
The uninstaller retains these backups and user settings.
