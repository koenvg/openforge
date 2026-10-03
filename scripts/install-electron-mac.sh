#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--cold" ]]; then
  shift
fi

# Local source installation uses native cold approval, not the disabled live-update
# path. The helper still refuses running processes and verifies the app before
# publication; do not bypass it with process cleanup or direct bundle replacement.
exec node "$(dirname -- "${BASH_SOURCE[0]}")/cold-install-mac.mjs" "$@"
