## Context

See `proposal.md` for motivation and `specs/terminal-session-coordination/spec.md` for required behavior.

`PoolEntry` currently combines long-lived Terminal Session state, Terminal View resources, transport subscriptions, observer handles, recovery promises, output sequencing, and lifecycle flags. `terminalStateView`, `terminalAttachment`, and `terminalSessionLifecycle` all mutate overlapping fields. Asynchronous replay, visibility, attachment, and PTY events therefore coordinate through captured numbers and direct field checks spread across several files.

The package already has two real seams. `TerminalTransport` carries replay and PTY events, while `TerminalView` renders snapshots and live output. Both have test adapters. The new module should use those seams directly rather than add another transport or renderer abstraction.

The desktop and Terminal plugin consume the runtime through facades. Some callers currently reach into `PoolEntry.view` for geometry or fitting, and diagnostics inspect pool entries directly. These callers must migrate with the package interface.

## Goals / Non-Goals

**Goals:**

- Put all PTY-instance, authority-watermark, attachment-generation, visibility, recovery, and geometry-lease transitions behind one per-session interface.
- Make stale asynchronous work harmless by construction.
- Reduce the Terminal Runtime interface by replacing coordinated setter sequences with capability handles.
- Keep tests focused on behavior observable through Terminal Runtime, Terminal Transport, Terminal View, lifecycle subscriptions, and read-only diagnostics.
- Preserve current acquisition rollback and shared owner-scoped Terminal Session behavior.

**Non-Goals:**

- Changing the Terminal Transport wire contract or Rust Sidecar commands.
- Changing Ghostty Terminal State Authority, renderer selection, snapshot encoding, or image compatibility replay.
- Moving PTY ownership into the renderer.
- Changing task terminal tab policy or owner accounting in `TerminalSessionService`.
- Adding native Ghostty rendering or companion geometry arbitration.

## Decisions

### Use one coordinator per Terminal Session

Add `terminalSessionCoordinator.ts` with a `createTerminalSessionCoordinator` factory. Its closure owns the mutable state and resources for one Shell Session Key. The runtime registry stores coordinators and returns opaque Terminal Session handles to callers.

The coordinator receives the existing `TerminalTransport`, `TerminalView`, environment, and lifecycle notification callback. It owns transport event handling, authoritative recovery, attachment observers, fit retries, visibility retries, output sequencing, and deterministic disposal.

```ts
declare const terminalSessionBrand: unique symbol

export interface TerminalSession {
  readonly shellSessionKey: string
  readonly [terminalSessionBrand]: true
}

interface TerminalSessionCoordinator {
  readonly session: TerminalSession

  start(): Promise<void>
  attach(host: HTMLDivElement): Promise<TerminalViewAttachment>
  beginPtySpawn(): TerminalPtySpawnLease | null
  restorePtyInstance(instanceId: number): Promise<void>
  recoverFromAuthority(): Promise<void>
  handleTransportEvent(event: TerminalSessionTransportEvent): void

  getLifecycleState(): ShellLifecycleState
  subscribeLifecycle(listener: ShellLifecycleListener): TerminalRuntimeUnlistenFn
  resetPresentation(): Promise<void>
  focus(): void
  refresh(): void
  dispose(): void
}
```

`start()` installs the session subscription before reading replay so output that races initialization can be held safely. It also installs view input forwarding. Any failure disposes every provisional resource, allowing acquisition to retry cleanly.

Alternative considered: retain `PoolEntry` and wrap individual fields with getters and setters. This only moves assignments and leaves ordering knowledge in callers.

Alternative considered: use a generic reducer that emits side-effect commands. Callers would still need to interpret replay, rendering, subscription, and cancellation order, so the module would remain shallow.

### Return opaque session handles

Replace the exported mutable `PoolEntry` with a branded `TerminalSession` handle. Only Terminal Runtime resolves a handle to its coordinator. The handle exposes its Shell Session Key for identity and logging, but no mutable fields or direct Terminal View reference.

This is an intentional package interface break. Keeping a compatibility object with writable fields would preserve the seam this change removes.

`TerminalSessionService` continues owner accounting by Shell Session Key and returns the opaque handle from acquisition. Desktop and plugin facades re-export the new types.

### Represent attachment and geometry ownership as one capability

`attach` returns a generation-bound `TerminalViewAttachment` capability:

```ts
export interface TerminalViewAttachment {
  readonly generation: number
  refit(signal?: AbortSignal): Promise<TerminalGeometry | null>
  detach(): void
}
```

The capability captures its attachment generation. `detach` and `refit` validate that generation inside the coordinator. Observer callbacks capture the same generation and visibility generation. A stale capability cannot unmount, focus, recover, or resize a replacement attachment.

The active visible attachment owns the Terminal Geometry Lease. `refit` returns validated dimensions only when the capability still owns that lease. Resize observers use the same check before calling transport resize.

Callers such as `AgentTerminalShell.svelte` use `attachment.refit()` instead of `session.view.fit()`. `recoverActiveTerminal` is replaced because its current behavior is attachment fitting, not terminal-state recovery.

Alternative considered: expose `fitTerminal(session)` on the runtime. That hides the view but loses attachment identity, which makes stale layout callbacks harder to reject.

### Replace spawn mutators with a spawn lease

Collapse `shouldSpawnPty`, `markPtySpawnPending`, `markShellPtyStarted`, and `clearPtySpawnPending` into `beginPtySpawn`:

```ts
export interface TerminalPtySpawnLease {
  readonly geometry: TerminalGeometry
  readonly imageProtocol: TerminalImageProtocol | null
  started(instanceId: number): Promise<void>
  cancel(): void
}
```

The coordinator issues at most one live lease. It marks output observation empty when issuing the lease. `started` selects the PTY instance, resets instance-scoped watermarks and observations, resolves Ghostty authority, and only then releases eligible pending output. `cancel` is idempotent and cannot clear a newer lease.

The lease takes its geometry from the current Terminal Geometry Lease and packages the renderer image protocol required by the PTY spawn request.

Alternative considered: preserve the four runtime methods with opaque handles. That removes field mutation but still requires every caller to maintain the same try/finally ordering.

### Keep one private state record with semantic transitions

The coordinator keeps a private state record grouped by responsibility:

```ts
interface TerminalSessionState {
  pty: {
    instanceId: number | null
    active: boolean
    exited: boolean
    spawnGeneration: number
    spawnPending: boolean
    needsClear: boolean
    hasOutput: boolean
  }
  authority: {
    source: 'bootstrapping' | 'ghostty-snapshot'
    watermark: number | null
    viewSequence: number
    pendingOutput: TerminalModelOutputEvent[]
  }
  attachment: {
    generation: number
    visibilityGeneration: number
    status: 'detached' | 'hidden' | 'visible'
    needsRecovery: boolean
  }
  recovery: {
    inFlight: Promise<void> | null
  }
}
```

No module outside the coordinator receives this type. State changes occur through named transitions such as PTY selection, accepted output, authoritative replay, attachment replacement, visibility change, recovery completion, and disposal. A transition updates all related fields before notifying lifecycle listeners.

`needsClear` remains presentation policy and never determines PTY liveness.

### Validate PTY identity separately from presentation revision

Every authority read captures the current PTY instance. A replay can commit only if that instance remains selected and, when non-null, matches the replay instance.

Rendering requires a separate presentation permit containing attachment generation and visibility generation. A replay that is current for the Terminal Session but stale for the view may update authority metadata while marking the view dirty. It cannot render into the replaced or hidden attachment. A current visible attachment then performs a fresh recovery.

This split preserves both requirements. PTY replacement rejects stale authority entirely, while attachment replacement does not discard valid session authority.

### Keep recovery and pending output inside the coordinator

The coordinator owns the one in-flight recovery promise. Recovery performs these steps:

1. Capture PTY identity and the current visible presentation permit.
2. Mark the session authority source as bootstrapping.
3. Read replay through `TerminalTransport`.
4. Reject the replay if PTY identity changed.
5. Apply the authoritative instance, lifecycle state, snapshot watermark, and output observation.
6. Replace the snapshot only when the presentation permit remains current.
7. Flush only contiguous pending output newer than the snapshot watermark.
8. Leave the view dirty when rendering could not commit.

Pending output remains bounded and is used only while authority or PTY selection is unresolved. Hidden or detached output advances eligible observation state and marks presentation dirty instead of filling the queue.

Visible recovery retains the existing retry policy. Every retry checks current attachment and visibility generations. Hiding or detaching stops retries and pauses model output.

### Narrow the existing modules

`terminalRuntime.ts` composes the registry, owner-neutral public operations, theme propagation, and reconnect listener.

`terminalAcquisition.ts` deduplicates acquisition, creates and starts coordinators, registers them only after successful initialization, and disposes provisional coordinators on release or failure.

`terminalSessionLifecycle.ts` retains pending restored-instance metadata, task terminal tab sessions, and keyed lookup before acquisition. It delegates existing-session transitions to the coordinator and does not mutate session state.

`terminalStateView.ts` and `terminalAttachment.ts` are removed after their stateful behavior moves into the coordinator. Pure helpers such as terminal-dimension validation may remain in focused files.

`terminalReconnectReplay.ts` iterates coordinators and calls `recoverFromAuthority`. It no longer reads `needsClear`, attachment, or view fields directly. The coordinator decides whether recovery and refresh apply.

### Replace pool inspection with read-only diagnostics

Remove `_getPool` and `getTerminalEntriesForObservation`. Add a diagnostics interface that returns immutable lifecycle, authority, output-observation, geometry, and presentation evidence by Shell Session Key. Presentation capture and drain operations remain explicit asynchronous diagnostics operations.

Integration tests should prefer fake Terminal Transport and Terminal View observations. Diagnostics exist for full-app probes and conformance evidence, not as a back door for production mutation.

### Test through the Terminal Runtime interface

Retain the current integration scenarios and rewrite internal-field assertions as runtime-observable outcomes:

- Transport listener state and replay calls show visibility suspension and recovery.
- Terminal View snapshot and live-write calls show watermark ordering and stale output rejection.
- Lifecycle subscriptions show PTY selection, output observation, and exit behavior.
- Attachment capabilities and mounted view observations show stale-generation rejection.
- Transport resize calls show Terminal Geometry Lease ownership.
- Read-only diagnostics support performance and conformance probes.

Coordinator-focused tests may cover failure cleanup and transition combinations, but they do not replace the Terminal Runtime integration suite.

## Risks / Trade-offs

- [Risk] Migrating the exported `PoolEntry` type affects desktop, plugin, tests, and diagnostic code in one change. -> Migrate all workspace consumers in the same task sequence and run full affected-system checks.
- [Risk] Combining attachment and replay logic in one module may create a large implementation file. -> Keep one coordination interface and private state owner, then extract only pure helpers for fitting, backoff, or data conversion. Do not split invariant ownership.
- [Risk] Reordering initialization can drop output or leak subscriptions. -> Preserve subscription-before-replay ordering and test rollback at every asynchronous acquisition step.
- [Risk] A recovery completion may be valid for session authority but stale for presentation. -> Use separate PTY and presentation permits and test both races.
- [Risk] Removing direct view access may expose missing runtime operations. -> Add only semantic attachment or diagnostics operations required by real callers; do not re-export the Terminal View.
- [Trade-off] Opaque handles make small unit fakes less convenient. -> Build fakes at the Terminal Runtime interface or use package test-support factories instead of constructing partial session records.

## Migration Plan

1. Add Terminal Runtime integration tests that express the opaque-handle, spawn-lease, attachment-refit, and read-only diagnostics contracts before changing implementation.
2. Add the coordinator and move PTY identity, snapshot ordering, output sequencing, recovery, attachment, visibility, and geometry state behind it.
3. Change acquisition, lifecycle, reconnect, runtime composition, and disposal to use coordinators.
4. Replace the public `PoolEntry` interface with opaque session, attachment, spawn-lease, and diagnostics types.
5. Migrate task terminal controllers, agent terminal code, desktop and plugin facades, tests, performance probes, and conformance helpers.
6. Remove obsolete stateful attachment and state-view modules plus `_getPool` access after all callers move.
7. Run the full terminal-runtime suite and build, affected desktop tests and static checks, Terminal plugin checks, and applicable conformance runs.

The change is source-only and has no persisted-data migration. Rollback is a normal code revert because the transport and database contracts do not change.
