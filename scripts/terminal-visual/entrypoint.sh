#!/usr/bin/env bash
set -euo pipefail

mkdir -p /work
# Install and build inside the container. Host dependencies may target another OS or architecture.
tar -C /source \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=target \
  --exclude=artifacts \
  --exclude=screenshots \
  --exclude=storybook-static \
  --exclude=dist \
  --exclude=dist-electron \
  -cf - . | tar -C /work -xf -

rm -rf /work/packages/terminal-runtime/conformance/baselines/linux-arm64
ln -s /terminal-baselines /work/packages/terminal-runtime/conformance/baselines/linux-arm64
rm -rf /work/packages/pr-review-ui/src/visual-baselines
ln -s /markdown-baselines /work/packages/pr-review-ui/src/visual-baselines
mkdir -p /work/artifacts /work/screenshots
ln -s /terminal-output /work/artifacts/terminal-presentation
ln -s /markdown-output /work/screenshots/markdown-visual

cd /work
corepack enable
pnpm install --frozen-lockfile --store-dir /pnpm-store

terminal_args=(--browser-only)
if [[ "$TERMINAL_VISUAL_MODE" == 'update' ]]; then
  terminal_args+=(--update-baselines)
  export UPDATE_MARKDOWN_VISUALS=1
fi

node packages/terminal-runtime/conformance/run.mjs "${terminal_args[@]}"
RUN_MARKDOWN_VISUALS=1 pnpm exec vitest run packages/pr-review-ui/src/RichMarkdownDiff.visual.test.ts
