## Why

Terminal input can stop working across the app while agents continue producing output, and new terminals fail with `session capacity exhausted`. Inspection found that input, resize, and lifecycle operations share a 1,024-entry history that never retires records; the running daemon's counter has not been captured, so this explains the observed symptoms but is not yet a confirmed live diagnosis.

## What Changes

- Replace lifetime accumulation of operation receipts with bounded, safely retired retry history, so ordinary continued use does not exhaust terminal operation capacity.
- Preserve at-most-once execution, PTY ordering, controller fencing, and unknown-outcome handling through reconnects and daemon replacement.
- Recover capacity from existing retained history only when stale requests can be rejected safely, without terminating live sessions.
- On attachment to an older daemon, automatically attempt supported in-place upgrade before enabling receipt retirement; refuse safely if incompatible, without killing sessions.
- Distinguish operation-history pressure from live-session limits in actionable diagnostics and errors.
- Add sustained-use and fault-injection regressions covering input, resize, terminal creation, retry, and replacement.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-session-coordination`: Require bounded operation retention with sustained terminal availability, safe retries after retirement, recovery across controller and daemon transitions, and distinguishable capacity failures.

## Impact

Primary scope is the Rust session host, protocol, client, daemon, and sidecar terminal-control integration. Protocol and checkpoint compatibility require explicit handling, coordinated with the existing `preserve-sessions-across-updates` change. Renderer error handling and typed IPC wrappers are affected only where needed to expose diagnostic distinctions. No new dependencies, terminal-rendering redesign, automatic process termination, or production daemon restart is proposed.
