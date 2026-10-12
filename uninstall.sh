#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_USER="${SUDO_USER:-$(id -un)}"
TARGET_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6)"
DATA_DIR="${KCW_DATA_DIR:-${TARGET_HOME}/printer_data}"
CONFIG_DIR="${KCW_CONFIG_DIR:-${DATA_DIR}/config}"
ASVC_FILE="${DATA_DIR}/moonraker.asvc"
NGINX_SITE="${KCW_NGINX_SITE:-/etc/nginx/sites-available/mainsail}"
MAINSAIL_NAVI="${KCW_MAINSAIL_NAVI:-${CONFIG_DIR}/.theme/navi.json}"
MAINSAIL_DIR="${KCW_MAINSAIL_DIR:-${TARGET_HOME}/mainsail}"
MAINSAIL_STATE="${KCW_MAINSAIL_STATE_DIR:-${CONFIG_DIR}/.klipper-calibration-wizard/mainsail}"

sudo systemctl disable --now klipper-tools-mainsail-repair.path 2>/dev/null || true
sudo systemctl stop klipper-tools-mainsail-repair.service 2>/dev/null || true
if [[ -f "${MAINSAIL_STATE}/last-backup.json" ]]; then
  sudo -u "${TARGET_USER}" "${PROJECT_DIR}/.venv/bin/python" -m calibration_wizard.mainsail_build \
    --restore --root "${MAINSAIL_DIR}" --state "${MAINSAIL_STATE}" \
    --template "${PROJECT_DIR}/integrations/mainsail/Tools.vue"
fi
sudo rm -f /etc/systemd/system/klipper-tools-mainsail-repair.service /etc/systemd/system/klipper-tools-mainsail-repair.path

sudo systemctl disable --now klipper-calibration-wizard.service 2>/dev/null || true
sudo rm -f /etc/systemd/system/klipper-calibration-wizard.service
sudo systemctl daemon-reload
if [[ -f "${ASVC_FILE}" ]]; then sed -i.bak '/^klipper-calibration-wizard$/d' "${ASVC_FILE}"; fi
if [[ -f "${NGINX_SITE}" ]]; then
  sudo python3 "${PROJECT_DIR}/scripts/configure_nginx.py" --remove "${NGINX_SITE}" "${PROJECT_DIR}/config/nginx-location.conf"
  sudo nginx -t && sudo systemctl reload nginx
fi
if [[ -f "${MAINSAIL_NAVI}" ]]; then
  python3 "${PROJECT_DIR}/scripts/configure_mainsail.py" --remove "${MAINSAIL_NAVI}" >/dev/null
fi
sudo systemctl restart moonraker.service 2>/dev/null || true
printf 'Integration removed. User data and backups in %s were retained.\n' "${DATA_DIR}"
printf 'Remove the Wizard update_manager section from your Moonraker configuration manually, then restart Moonraker.\n'
printf 'Remove %s and its .venv manually if you no longer need the repository.\n' "${PROJECT_DIR}"
