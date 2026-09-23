## Why

A user can reach the Session Daemon's 32-live-PTY ceiling during ordinary work. Increasing that one number would leave replacement unable to checkpoint more than 32 live resources and allow retained session history to stop new terminals after 128 allocations. The daemon needs safe, observable capacity for substantially more simultaneous agents and shells without sacrificing running sessions during an update.

## What Changes

- Remove the small fixed live-PTY ceiling as the primary admission policy. Admit new terminals while bounded daemon and OS resources are available; refuse them explicitly before exhausting resources needed to serve and recover existing terminals.
- Support more than 100 simultaneous agent and indexed-shell PTYs, using 256 concurrent PTYs as a validation workload, not as a new hard cap or a claim of unlimited capacity.
- Make retained exit/history policy sustainable across repeated terminal lifecycles, with explicit expiration and recovery semantics rather than silently losing live ownership or filling an irreversible lifetime allocation quota.
- Scale replacement checkpoint, descriptor, memory, and time budgets together with admission. Preserve every live PTY on successful replacement, or refuse replacement without losing sessions when safe checkpointing is unavailable. Handle persisted limits from older 32-PTY daemons without resetting sessions.
- Expose capacity usage, limiting resource, and failure reason without revealing terminal contents. Cover full-capacity spawn, turnover, recovery, and replacement with tests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-session-coordination`: Define resource-based terminal admission, sustainable retained-session capacity, and replacement continuity above 100 concurrent PTYs.

## Impact

Session Daemon admission and checkpointing (`src-tauri/crates/session-daemon`), shared host state and checkpoint compatibility (`src-tauri/crates/session-host`), protocol/client capacity diagnostics if needed (`src-tauri/crates/session-protocol`, `src-tauri/crates/session-client`), integration/stress tests, and daemon capacity documentation. No new external service or automatic termination of existing sessions is proposed.
