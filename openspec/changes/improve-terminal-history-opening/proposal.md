## Why

First opening a task with output history visibly scrolls through saved output before the terminal settles. Concealing intermediate restoration frames will stop this distracting playback without discarding history; it does not promise faster replay.

## What Changes

- Keep terminal contents concealed while authoritative history and screen state are restored, retaining measurable layout dimensions.
- Reveal the completed current screen only after parsing and presentation are ready, without exposing intermediate replay frames.
- Preserve scrollback, inline images, live-output ordering, attachment generation safety, and recovery behavior.
- Validate the experience against a long-history first-open fixture. Investigate screen-first rendering with asynchronously loaded scrollback separately.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-session-coordination`: Require presentation of completed restoration rather than intermediate history playback.

## Impact

Primary implementation area is `packages/terminal-runtime`, particularly `xtermTerminalView.ts`, `xtermPresentation.ts`, and attachment/restoration integration tests. Keep the shared renderer behavior consistent across task terminals. No backend protocol, Ghostty dependency, persistence, or renderer replacement is proposed. Existing terminal lifecycle and transport contracts remain authoritative.
