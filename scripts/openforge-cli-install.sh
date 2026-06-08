# Shared OpenForge macOS CLI install helpers.
# POSIX-compatible because scripts/install.sh sources this file with /bin/sh.

install_openforge_cli_payload() {
  openforge_cli_app_path=$1
  openforge_cli_missing_policy=${2:-warn}
  openforge_cli_source_dir="${openforge_cli_app_path}/Contents/Resources/openforge-cli"
  openforge_cli_target_dir="${HOME}/Library/Application Support/openforge/cli"

  if [ ! -f "${openforge_cli_source_dir}/cli.js" ]; then
    if [ "${openforge_cli_missing_policy}" = "error" ]; then
      echo "ERROR: OpenForge CLI payload not found at ${openforge_cli_source_dir}/cli.js" >&2
      return 1
    fi

    echo "WARNING: OpenForge CLI payload not found at ${openforge_cli_source_dir}/cli.js; continuing without updating CLI payload" >&2
    return 0
  fi

  rm -rf "${openforge_cli_target_dir}" || return 1
  mkdir -p "${openforge_cli_target_dir}" || return 1
  cp -R "${openforge_cli_source_dir}/." "${openforge_cli_target_dir}/" || return 1
  echo "Installed OpenForge CLI payload to ${openforge_cli_target_dir}"
}

install_openforge_cli_launcher() {
  openforge_cli_bin_dir="${HOME}/.openforge/bin"
  openforge_cli_launcher="${openforge_cli_bin_dir}/openforge"
  openforge_cli_launcher_tmp="${openforge_cli_bin_dir}/.openforge.$$"
  openforge_cli_target="${HOME}/Library/Application Support/openforge/cli/cli.js"
  openforge_cli_zshrc="${HOME}/.zshrc"

  mkdir -p "${openforge_cli_bin_dir}" || return 1
  if [ ! -w "${openforge_cli_bin_dir}" ]; then
    echo "ERROR: OpenForge CLI launcher directory is not writable at ${openforge_cli_bin_dir}" >&2
    echo "This usually means an earlier install created it with sudo or root ownership." >&2
    echo "Fix ownership, then rerun install: sudo chown -R \"$(id -un)\" \"${openforge_cli_bin_dir}\"" >&2
    return 1
  fi

  if ! cat > "${openforge_cli_launcher_tmp}" <<EOF
#!/bin/sh
exec node "${openforge_cli_target}" "\$@"
EOF
  then
    rm -f "${openforge_cli_launcher_tmp}" 2>/dev/null || true
    return 1
  fi
  if ! chmod 755 "${openforge_cli_launcher_tmp}"; then
    rm -f "${openforge_cli_launcher_tmp}" 2>/dev/null || true
    return 1
  fi
  if ! mv -f "${openforge_cli_launcher_tmp}" "${openforge_cli_launcher}"; then
    rm -f "${openforge_cli_launcher_tmp}" 2>/dev/null || true
    return 1
  fi

  if ! grep -qs '\.openforge/bin' "${openforge_cli_zshrc}" 2>/dev/null; then
    {
      echo ""
      echo "# OpenForge CLI"
      echo 'export PATH="$HOME/.openforge/bin:$PATH"'
    } >> "${openforge_cli_zshrc}"
  fi

  echo "Installed OpenForge CLI launcher to ${openforge_cli_launcher}"
}

install_openforge_cli() {
  openforge_cli_app_path=$1
  openforge_cli_missing_policy=${2:-warn}

  install_openforge_cli_payload "${openforge_cli_app_path}" "${openforge_cli_missing_policy}" || return 1
  install_openforge_cli_launcher
}
