#!/usr/bin/env bash
set -euo pipefail

# Cold installation requires native approval and refuses running OpenForge
# processes. It does not enable session-preserving or published updates.
# Keep --cold as an alias for existing scripts.
if [[ "${1:-}" == "--cold" ]]; then
  shift
fi
exec node "$(dirname -- "${BASH_SOURCE[0]}")/cold-install-mac.mjs" "$@"
