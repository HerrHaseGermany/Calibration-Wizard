# Installation

## Supported layout

The installer targets a normal Debian-based Klipper host using systemd and the common `~/printer_data` layout used by MainsailOS and current Moonraker installations. It does not modify Mainsail or Klipper source code.

```bash
cd ~
git clone https://github.com/HerrHaseGermany/Calibration-Wizard.git
cd Calibration-Wizard
./install.sh
```

Run the installer from the Git checkout. Archive downloads are intentionally rejected because Moonraker can only update a real, branch-based Git repository. The script detects the checkout's `origin` and active branch, checks prerequisites, creates `.venv`, installs the Python package, installs and enables a hardened systemd unit, adds a separate Moonraker update-manager include, authorizes Moonraker to restart the service, adds a validated nginx `/calibration/` route when the standard Mainsail site is found, and installs a **Calibration** link through Mainsail's supported `.theme/navi.json` extension. Existing custom navigation entries are preserved and the previous file is backed up before a change.

Override nonstandard layouts with `KCW_DATA_DIR`, `KCW_CONFIG_DIR`, `KCW_MOONRAKER_CONFIG`, `KCW_KLIPPER_CONFIG`, `KCW_NGINX_SITE`, or `KCW_MAINSAIL_NAVI`.

Run `./install.sh --check` for a non-mutating preflight of interpreter and repository assets. It works on a development machine without Klipper; the actual installation remains Linux-only.

## Moonraker authorization

The backend connects to `http://127.0.0.1:7125`. Standard installations trust localhost. If yours requires an API key, add `KCW_MOONRAKER_API_KEY=<key>` to `~/printer_data/config/.klipper-calibration-wizard/service.env`, restrict that file to mode `0640`, and restart the service. Never commit this value.

## Nonstandard reverse proxy

If the installer cannot find `/etc/nginx/sites-available/mainsail`, copy the two location blocks from `config/nginx-location.conf` into the relevant `server {}` block, run `sudo nginx -t`, and reload nginx. The trailing slash on `proxy_pass http://127.0.0.1:7130/;` is required.

## Updates through Obico or another Moonraker client

Obico uses Moonraker's Update Manager for Klipper installations. Moonraker loads `klipper-calibration-wizard-update.conf` and exposes **klipper-calibration-wizard** to Obico and other compatible clients. The generated entry points to the actual Git origin and branch used for installation. Its current `git_repo` format uses `virtualenv` and `requirements`; deprecated `env` and `install_script` fields are not used. Moonraker pulls the pristine Git checkout, updates Python requirements when necessary, and restarts the Wizard service. `.venv`, backups, and service environment are ignored/untracked and user configuration is outside the checkout.

The `dev` update channel follows new commits on the installed branch. Releases are also tagged with semantic versions so clients can report a useful installed version. If local files in the checkout are edited, the Update Manager will report the repository as dirty; keep printer-specific settings in `~/printer_data`, not inside this repository.

After installation or an update, verify the entry through Moonraker:

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

Installer backups of existing Moonraker, update-manager, nginx, or Mainsail navigation files use a leading dot (for example `.moonraker.conf.kcw-backup-<timestamp>`). Mainsail hides these safety copies by default; enable its “show hidden files” option when a manual restore is required.

## Uninstall

```bash
./uninstall.sh
```

This stops/removes the service and removes only the managed Moonraker/nginx integration. Calibration backups and the service environment are retained. No Klipper configuration or unrelated include is deleted.

## Troubleshooting

```bash
systemctl status klipper-calibration-wizard
journalctl -u klipper-calibration-wizard -n 100 --no-pager
curl http://127.0.0.1:7130/api/status
sudo nginx -t
```

If permanent saving is unavailable, inspect `config_source` in `/api/wizards/extruder`. External and symlinked includes may be read for origin detection, but the writer deliberately refuses to modify settings outside the Klipper config root. It also rejects duplicate sections/settings, computed values, unreadable files, and a value changed since the session began.
