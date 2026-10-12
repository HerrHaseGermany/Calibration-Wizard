#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="klipper-calibration-wizard"
EXPECTED_ORIGIN="https://github.com/HerrHaseGermany/Calibration-Wizard.git"

read_git_metadata() {
  [[ -d "${PROJECT_DIR}/.git" ]] || fail "This installation must be a Git checkout. Clone ${EXPECTED_ORIGIN} first."
  GIT_ORIGIN="$(git -C "${PROJECT_DIR}" remote get-url origin 2>/dev/null || true)"
  GIT_BRANCH="$(git -C "${PROJECT_DIR}" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  [[ -n "${GIT_ORIGIN}" ]] || fail "Git remote 'origin' is missing."
  [[ -n "${GIT_BRANCH}" ]] || fail "A local Git branch must be checked out; detached HEAD is not supported."
  [[ "${GIT_ORIGIN}" == https://github.com/* || "${GIT_ORIGIN}" == git@github.com:* ]] || \
    fail "Moonraker git_repo updates require a GitHub origin; found: ${GIT_ORIGIN}"
}

if [[ "${1:-}" == "--check" ]]; then
  command -v python3 >/dev/null || { printf 'python3 is required\n' >&2; exit 1; }
  command -v git >/dev/null || { printf 'git is required\n' >&2; exit 1; }
  fail() { printf '[calibration-wizard] ERROR: %s\n' "$*" >&2; exit 1; }
  read_git_metadata
  python3 -c 'import sys; assert sys.version_info >= (3, 9), "Python 3.9+ is required"'
  for required in \
    pyproject.toml requirements.txt frontend/index.html \
    config/klipper-calibration-wizard.service.in \
    config/klipper-tools-mainsail-repair.service.in \
    config/klipper-tools-mainsail-repair.path.in integrations/mainsail/Tools.vue \
    config/mainsail-navi-entry.json scripts/configure_mainsail.py; do
    [[ -f "${PROJECT_DIR}/${required}" ]] || { printf 'Missing install asset: %s\n' "${required}" >&2; exit 1; }
  done
  bash -n "${PROJECT_DIR}/install.sh" "${PROJECT_DIR}/update.sh" "${PROJECT_DIR}/uninstall.sh"
  printf '[calibration-wizard] Preflight passed. No system files were changed.\n'
  exit 0
fi

TARGET_USER="${SUDO_USER:-$(id -un)}"
TARGET_GROUP="$(id -gn "${TARGET_USER}")"
TARGET_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6)"
DATA_DIR="${KCW_DATA_DIR:-${TARGET_HOME}/printer_data}"
CONFIG_DIR="${KCW_CONFIG_DIR:-${DATA_DIR}/config}"
MOONRAKER_CONFIG="${KCW_MOONRAKER_CONFIG:-${CONFIG_DIR}/moonraker.conf}"
KLIPPER_CONFIG="${KCW_KLIPPER_CONFIG:-${CONFIG_DIR}/printer.cfg}"
BACKUP_DIR="${KCW_BACKUP_DIR:-${DATA_DIR}/backups/klipper-calibration-wizard}"
ENV_DIR="${DATA_DIR}/config/.klipper-calibration-wizard"
ENV_FILE="${ENV_DIR}/service.env"
ASVC_FILE="${DATA_DIR}/moonraker.asvc"
NGINX_SITE="${KCW_NGINX_SITE:-/etc/nginx/sites-available/mainsail}"
MAINSAIL_NAVI="${KCW_MAINSAIL_NAVI:-${CONFIG_DIR}/.theme/navi.json}"
MAINSAIL_DIR="${KCW_MAINSAIL_DIR:-${TARGET_HOME}/mainsail}"
MAINSAIL_STATE="${KCW_MAINSAIL_STATE_DIR:-${ENV_DIR}/mainsail}"
BUILD_PATH="${KCW_BUILD_PATH:-${PATH}}"

log() { printf '[calibration-wizard] %s\n' "$*"; }
fail() { printf '[calibration-wizard] ERROR: %s\n' "$*" >&2; exit 1; }
render() {
  sed -e "s|@SERVICE_USER@|${TARGET_USER}|g" \
      -e "s|@SERVICE_GROUP@|${TARGET_GROUP}|g" \
      -e "s|@PROJECT_DIR@|${PROJECT_DIR}|g" \
      -e "s|@ENV_FILE@|${ENV_FILE}|g" \
      -e "s|@CONFIG_DIR@|${CONFIG_DIR}|g" \
      -e "s|@KLIPPER_CONFIG@|${KLIPPER_CONFIG}|g" \
      -e "s|@BACKUP_DIR@|${BACKUP_DIR}|g" \
      -e "s|@MAINSAIL_NAVI@|${MAINSAIL_NAVI}|g" \
      -e "s|@MAINSAIL_DIR@|${MAINSAIL_DIR}|g" \
      -e "s|@MAINSAIL_STATE@|${MAINSAIL_STATE}|g" \
      -e "s|@BUILD_PATH@|${BUILD_PATH}|g" "$1"
}

[[ "$(uname -s)" == "Linux" ]] || fail "Installation is supported on Linux only. Use KCW_MOCK=true for local development."
command -v python3 >/dev/null || fail "python3 is required"
command -v git >/dev/null || fail "git is required"
command -v systemctl >/dev/null || fail "systemd is required"
read_git_metadata
[[ -f "${MOONRAKER_CONFIG}" ]] || fail "Moonraker config not found: ${MOONRAKER_CONFIG}"
[[ -f "${KLIPPER_CONFIG}" ]] || fail "Klipper config not found: ${KLIPPER_CONFIG}"

# Check build prerequisites before changing services or proxy configuration.
if [[ -f "${MAINSAIL_DIR}/release_info.json" ]]; then
  command -v node >/dev/null || fail "Node.js 20.19+ or 22.12+ is required to build the Mainsail extension"
  command -v npm >/dev/null || fail "npm is required to build the Mainsail extension"
  command -v zip >/dev/null || fail "zip is required to package the Mainsail frontend"
  node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(!((major===20 && minor>=19)||(major===22 && minor>=12)||major>22))process.exit(1)' || fail "Node.js must be 20.19+ (20.x), 22.12+ (22.x), or newer"
  sudo -u "${TARGET_USER}" test -w "${MAINSAIL_DIR}" || fail "Mainsail directory must be writable by ${TARGET_USER}: ${MAINSAIL_DIR}"
fi

log "Creating Python virtual environment"
python3 -m venv "${PROJECT_DIR}/.venv"
"${PROJECT_DIR}/.venv/bin/python" -m pip install --upgrade pip
"${PROJECT_DIR}/.venv/bin/pip" install --editable "${PROJECT_DIR}"

install -d -m 0750 -o "${TARGET_USER}" -g "${TARGET_GROUP}" "${ENV_DIR}" "${BACKUP_DIR}"
if [[ ! -f "${ENV_FILE}" ]]; then
  render "${PROJECT_DIR}/config/klipper-calibration-wizard.env.in" > "${ENV_FILE}"
  chown "${TARGET_USER}:${TARGET_GROUP}" "${ENV_FILE}"
  chmod 0640 "${ENV_FILE}"
else
  log "Keeping existing service environment: ${ENV_FILE}"
fi

log "Installing systemd service"
tmp_service="$(mktemp)"
render "${PROJECT_DIR}/config/klipper-calibration-wizard.service.in" > "${tmp_service}"
sudo install -m 0644 "${tmp_service}" "/etc/systemd/system/${SERVICE_NAME}.service"
rm -f "${tmp_service}"

log "Authorizing Moonraker to restart the service"
touch "${ASVC_FILE}"
if ! grep -Fqx "${SERVICE_NAME}" "${ASVC_FILE}"; then
  printf '%s\n' "${SERVICE_NAME}" >> "${ASVC_FILE}"
fi
chown "${TARGET_USER}:${TARGET_GROUP}" "${ASVC_FILE}"

if [[ -f "${NGINX_SITE}" ]] && command -v nginx >/dev/null; then
  log "Installing /tools/ nginx route"
  nginx_backup="$(sudo python3 "${PROJECT_DIR}/scripts/configure_nginx.py" "${NGINX_SITE}" "${PROJECT_DIR}/config/nginx-location.conf")"
  if ! sudo nginx -t; then
    [[ -n "${nginx_backup}" ]] && sudo cp -a "${nginx_backup}" "${NGINX_SITE}"
    fail "nginx validation failed; the previous configuration was restored"
  fi
else
  log "No Mainsail nginx site detected; see docs/INSTALLATION.md for manual proxy setup"
fi

log "Removing the legacy direct sidebar link"
if [[ -f "${MAINSAIL_NAVI}" ]]; then
  python3 "${PROJECT_DIR}/scripts/configure_mainsail.py" --remove "${MAINSAIL_NAVI}" >/dev/null
fi

if [[ -f "${MAINSAIL_DIR}/release_info.json" ]]; then
  install -d -m 0750 -o "${TARGET_USER}" -g "${TARGET_GROUP}" "${MAINSAIL_STATE}"
  # Preserve credentials and other user settings; replace only our integration keys.
  python3 - "${ENV_FILE}" "${MAINSAIL_DIR}" "${MAINSAIL_STATE}" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
keys = {"KCW_MAINSAIL_DIR", "KCW_MAINSAIL_STATE_DIR", "KCW_MAINSAIL_REPAIR_ENABLED"}
lines = [line for line in path.read_text().splitlines() if line.split("=", 1)[0] not in keys]
lines += [f'KCW_MAINSAIL_DIR="{sys.argv[2]}"', f'KCW_MAINSAIL_STATE_DIR="{sys.argv[3]}"', "KCW_MAINSAIL_REPAIR_ENABLED=true"]
path.write_text("\n".join(lines) + "\n")
PY
  for kind in service path; do
    render "${PROJECT_DIR}/config/klipper-tools-mainsail-repair.${kind}.in" > "${tmp_service}"
    sudo install -m 0644 "${tmp_service}" "/etc/systemd/system/klipper-tools-mainsail-repair.${kind}"
  done
  rm -f "${tmp_service}"
else
  log "Mainsail directory not detected at ${MAINSAIL_DIR}; standalone UI remains available. Set KCW_MAINSAIL_DIR and rerun to install the extension."
fi

sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}.service"
sudo systemctl restart "${SERVICE_NAME}.service"
if [[ -f "${MAINSAIL_DIR}/release_info.json" ]]; then
  sudo systemctl enable --now klipper-tools-mainsail-repair.path
fi
sudo systemctl restart moonraker.service
if [[ -f "${NGINX_SITE}" ]] && command -v nginx >/dev/null; then sudo systemctl reload nginx; fi
healthy=false
for _attempt in {1..20}; do
  if curl --fail --silent "http://127.0.0.1:7130/api/status" >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done
[[ "${healthy}" == true ]] || fail "Service health check failed; inspect journalctl -u ${SERVICE_NAME}"
if [[ -f "${MAINSAIL_DIR}/release_info.json" ]]; then
  # Moonraker's HTTP server can respond before Klipper reconnects after restart.
  integration_ready=false
  for _attempt in {1..60}; do
    if curl --fail --silent "http://127.0.0.1:7130/api/status" | \
      "${PROJECT_DIR}/.venv/bin/python" -c 'import json, sys; sys.exit(0 if json.load(sys.stdin).get("integration_idle") else 1)' 2>/dev/null; then
      integration_ready=true
      break
    fi
    sleep 1
  done
  if [[ "${integration_ready}" == true ]]; then
    sudo systemctl start --no-block klipper-tools-mainsail-repair.service
  else
    log "Mainsail build deferred: wait for Klipper and active Tools actions, then use Repair in /api/klipper-tools/."
  fi
fi
log "Installation complete: open http://printer/tools/; independent Repair UI: http://printer/api/klipper-tools/"
log "The Mainsail extension builds in the background; its status and Repair action are shown in the standalone UI."
log "Configure Moonraker Update Manager manually if needed; see README.md"
