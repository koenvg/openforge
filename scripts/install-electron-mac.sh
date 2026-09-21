#!/usr/bin/env bash
set -euo pipefail

# Do not fall back to process-name cleanup or direct bundle replacement. The
# packaged ReleaseStore preflight refuses replacement until publisher trust and
# the verified install-to-relaunch handoff are available. Source installs must
# obey that gate too, before building or changing any installed resource.
echo '[electron:failure] error install:preflight: Source installation is blocked.' >&2
echo 'Cause: Coordinated replacement requires trusted-release verification and a verified updater helper; these are not available yet.' >&2
echo 'No app, CLI, or session was changed.' >&2
echo 'Remediation: Use pnpm electron:package to build without installing. Do not replace a running app bundle manually.' >&2
echo 'First adoption from a pre-daemon build interrupts sessions and requires explicit approval; manual bundle replacement is not a guaranteed seamless handoff.' >&2
echo 'Decision: abort' >&2
exit 1
