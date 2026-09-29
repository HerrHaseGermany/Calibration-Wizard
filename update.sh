#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_USER="${SUDO_USER:-$(id -un)}"
TARGET_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6)"
DATA_DIR="${KCW_DATA_DIR:-${TARGET_HOME}/printer_data}"
CONFIG_DIR="${KCW_CONFIG_DIR:-${DATA_DIR}/config}"
MAINSAIL_NAVI="${KCW_MAINSAIL_NAVI:-${CONFIG_DIR}/.theme/navi.json}"
[[ -x "${PROJECT_DIR}/.venv/bin/pip" ]] || { printf 'Run ./install.sh first.\n' >&2; exit 1; }
"${PROJECT_DIR}/.venv/bin/pip" install --upgrade --editable "${PROJECT_DIR}"
python3 "${PROJECT_DIR}/scripts/configure_mainsail.py" \
  "${MAINSAIL_NAVI}" "${PROJECT_DIR}/config/mainsail-navi-entry.json" >/dev/null
sudo systemctl restart klipper-calibration-wizard.service
curl --fail --silent http://127.0.0.1:7130/api/status >/dev/null
printf 'Klipper Calibration Wizard updated.\n'
