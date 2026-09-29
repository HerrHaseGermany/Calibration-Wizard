#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_USER="${SUDO_USER:-$(id -un)}"
TARGET_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6)"
DATA_DIR="${KCW_DATA_DIR:-${TARGET_HOME}/printer_data}"
CONFIG_DIR="${KCW_CONFIG_DIR:-${DATA_DIR}/config}"
MOONRAKER_CONFIG="${KCW_MOONRAKER_CONFIG:-${CONFIG_DIR}/moonraker.conf}"
UPDATE_FILE="${CONFIG_DIR}/klipper-calibration-wizard-update.conf"
ASVC_FILE="${DATA_DIR}/moonraker.asvc"
NGINX_SITE="${KCW_NGINX_SITE:-/etc/nginx/sites-available/mainsail}"
MAINSAIL_NAVI="${KCW_MAINSAIL_NAVI:-${CONFIG_DIR}/.theme/navi.json}"

sudo systemctl disable --now klipper-calibration-wizard.service 2>/dev/null || true
sudo rm -f /etc/systemd/system/klipper-calibration-wizard.service
sudo systemctl daemon-reload
if [[ -f "${MOONRAKER_CONFIG}" ]]; then
  sed -i.bak '/^\[include klipper-calibration-wizard-update\.conf\]$/d' "${MOONRAKER_CONFIG}"
fi
rm -f "${UPDATE_FILE}"
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
printf 'Remove %s and its .venv manually if you no longer need the repository.\n' "${PROJECT_DIR}"
