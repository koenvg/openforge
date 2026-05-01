#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Open Forge"
BUNDLE_DIR="src-tauri/target/release/bundle/macos"
INSTALL_DIR="/Applications"

install_cli_launcher() {
  local cli_bin_dir="${HOME}/.openforge/bin"
  local cli_target="${HOME}/Library/Application Support/openforge/cli/cli.js"
  local zshrc="${HOME}/.zshrc"

  mkdir -p "${cli_bin_dir}"
  cat > "${cli_bin_dir}/openforge" <<EOF
#!/bin/sh
exec node "${cli_target}" "\$@"
EOF
  chmod 755 "${cli_bin_dir}/openforge"

  if ! grep -qs '\.openforge/bin' "${zshrc}" 2>/dev/null; then
    {
      echo ""
      echo "# OpenForge CLI"
      echo 'export PATH="$HOME/.openforge/bin:$PATH"'
    } >> "${zshrc}"
  fi

  echo "Installed OpenForge CLI launcher to ${cli_bin_dir}/openforge"
}

echo "Building ${APP_NAME}..."
pnpm tauri build

APP_PATH="${BUNDLE_DIR}/${APP_NAME}.app"

if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: Build artifact not found at ${APP_PATH}" >&2
  exit 1
fi

# Close running instance if any
if pgrep -xq "${APP_NAME}"; then
  echo "Closing running instance..."
  osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
  sleep 1
  # Force kill if still running
  pkill -x "${APP_NAME}" 2>/dev/null || true
fi

echo "Installing to ${INSTALL_DIR}..."
rm -rf "${INSTALL_DIR}/${APP_NAME}.app"
cp -R "$APP_PATH" "${INSTALL_DIR}/"

# Unsigned apps trigger macOS Gatekeeper — clear quarantine flag
xattr -rd com.apple.quarantine "${INSTALL_DIR}/${APP_NAME}.app"

install_cli_launcher

echo "Installed ${APP_NAME} to ${INSTALL_DIR}/${APP_NAME}.app"
echo "Restart your shell or run: source ~/.zshrc"
