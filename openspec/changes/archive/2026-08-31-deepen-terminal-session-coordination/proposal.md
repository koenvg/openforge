## Why

Terminal Runtime coordinates PTY identity, Ghostty snapshot ordering, view attachment, visibility, geometry, and recovery through a shared mutable `PoolEntry`. Correctness currently depends on several modules mutating related fields in the right order, which makes stale-instance and asynchronous attachment races difficult to reason about or test through the runtime interface.

## What Changes

- Add a per-session coordination module that owns PTY-instance selection, authority watermarks, attachment and visibility generations, recovery state, and the bounded pending-output queue.
- Replace cross-module `PoolEntry` field mutation with semantic Terminal Session operations and opaque session or lease handles.
- Make Terminal View Attachment capabilities generation-checked so stale detach, refit, visibility, and resize work cannot affect the current attachment.
- Preserve Ghostty Terminal State Authority, stale-instance rejection, Terminal View Attachment lifecycle independence, hidden-view output suspension, and Terminal Geometry Lease behavior.
- Move integration assertions away from mutable session internals and retain coverage through the Terminal Runtime interface with observable transport and view effects.
- Replace direct pool inspection used by test and performance probes with a read-only diagnostics interface.
- **BREAKING**: Remove the exported mutable `PoolEntry` contract and direct access to its `TerminalView`; callers use opaque Terminal Session, Terminal View Attachment, spawn-lease, and diagnostics interfaces instead.

## Capabilities

### New Capabilities

- `terminal-session-coordination`: Defines Terminal Runtime coordination requirements for PTY generations, authoritative snapshot ordering, attachment lifecycle, visibility recovery, stale-work rejection, and geometry leases.

### Modified Capabilities

None.

## Impact

- Affects `packages/terminal-runtime`, especially `terminalRuntime`, `terminalAcquisition`, `terminalStateView`, `terminalAttachment`, `terminalSessionLifecycle`, reconnect handling, runtime types, and package exports.
- Requires migration of desktop and Terminal plugin facades, task terminal controllers, agent terminal attachment code, test helpers, and terminal diagnostics that currently consume `PoolEntry` fields.
- Does not change the Terminal Transport wire contract, Ghostty authority ownership, PTY ownership, or renderer selection.
- Adds no dependency or database change.
