#!/usr/bin/env bash
set -euo pipefail
mkdir -p /work
# Never install into the host checkout or reuse native platform dependencies.
tar -C /source --exclude=node_modules --exclude=.git --exclude=target --exclude=artifacts --exclude=storybook-static --exclude=dist --exclude=dist-electron -cf - . | tar -C /work -xf -
cd /work
corepack enable
pnpm install --frozen-lockfile --store-dir /pnpm-store
pnpm storybook:build
node scripts/storybook-visual/run.mjs "$VISUAL_MODE"
