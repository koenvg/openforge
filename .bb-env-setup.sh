#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo 'OpenForge setup requires Node.js 22.23.4 or newer.' >&2
  exit 1
fi
if ! node -e 'const [major, minor, patch] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && (minor > 23 || (minor === 23 && patch >= 4))) ? 0 : 1)' >/dev/null; then
  echo 'OpenForge setup requires Node.js 22.23.4 or newer.' >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo 'OpenForge setup requires pnpm 10.34.3.' >&2
  exit 1
fi
if [[ "$(pnpm --version)" != '10.34.3' ]]; then
  echo 'OpenForge setup requires pnpm 10.34.3 (see package.json).' >&2
  exit 1
fi

pnpm --filter 'openforge...' install --frozen-lockfile
