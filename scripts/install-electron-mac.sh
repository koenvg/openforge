#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/openforge-cli-install.sh
. "${SCRIPT_DIR}/openforge-cli-install.sh"

APP_NAME="Open Forge"
INSTALL_DIR="${OPENFORGE_ELECTRON_INSTALL_DIR:-/Applications}"
SIDECAR_PROCESS_PATTERN='Open Forge.app/Contents/MacOS/openforge-sidecar'

report_failure() {
  local phase="$1"
  local severity="$2"
  local decision="$3"
  local user_message="$4"
  local remediation="$5"
  local cause="$6"

  echo "[electron:failure] ${severity} ${phase}: ${user_message}" >&2
  echo "Cause: ${cause}" >&2
  echo "Remediation: ${remediation}" >&2
  echo "Decision: ${decision}" >&2
}

wait_for_stale_sidecar_exit() {
  local attempt

  for attempt in 1 2 3 4 5; do
    if ! pgrep -fq "${SIDECAR_PROCESS_PATTERN}"; then
      return 0
    fi
    sleep 1
  done

  return 1
}

stop_running_app() {
  if pgrep -xq "${APP_NAME}"; then
    echo "Closing running instance..."
    osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
    sleep 1
    pkill -x "${APP_NAME}" 2>/dev/null || true
  fi

  if pgrep -fq "${SIDECAR_PROCESS_PATTERN}"; then
    report_failure \
      "install:stale-sidecar-cleanup" \
      "warning" \
      "continue" \
      "A stale OpenForge sidecar is still running during install." \
      "The installer will stop the stale sidecar before replacing the app bundle so the next launch cannot reuse the old backend." \
      "pgrep matched ${SIDECAR_PROCESS_PATTERN}"
    echo "Stopping stale Electron sidecar..."
    pkill -f "${SIDECAR_PROCESS_PATTERN}" 2>/dev/null || true

    if ! wait_for_stale_sidecar_exit; then
      echo "Stale Electron sidecar did not exit after SIGTERM; forcing it to stop..."
      pkill -9 -f "${SIDECAR_PROCESS_PATTERN}" 2>/dev/null || true
      if ! wait_for_stale_sidecar_exit; then
        report_failure \
          "install:stale-sidecar-cleanup" \
          "error" \
          "abort" \
          "A stale OpenForge sidecar is still running and could make the installed app use the old backend." \
          "Quit Open Forge completely or kill the openforge-sidecar process, then rerun pnpm electron:install." \
          "pgrep still matched ${SIDECAR_PROCESS_PATTERN} after SIGKILL"
        exit 1
      fi
    fi
  fi
}

echo "Building Electron ${APP_NAME}..."
pnpm electron:package

APP_PATH="$(node scripts/rust-sidecar-layout.mjs electron-app-path)"

if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: Build artifact not found at ${APP_PATH}" >&2
  exit 1
fi

stop_running_app

INSTALLED_APP_PATH="${INSTALL_DIR}/${APP_NAME}.app"

echo "Installing Electron app to ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"
rm -rf "${INSTALLED_APP_PATH}"
cp -R "$APP_PATH" "${INSTALL_DIR}/"

xattr -rd com.apple.quarantine "${INSTALLED_APP_PATH}" 2>/dev/null || true

install_openforge_cli "${INSTALLED_APP_PATH}" error

echo "Installed Electron ${APP_NAME} to ${INSTALLED_APP_PATH}"
echo "Restart your shell or run: source ~/.zshrc"
