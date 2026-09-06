## Context

See `proposal.md` for motivation and the four delta specs for behavior. This design qualifies because it changes process ownership, local transport, restart persistence, and update recovery across multiple subsystems.

Current ownership is deliberately destructive on Quit:

- `src/electron/bootLifecycle.ts`, `sidecar.ts`, and `shutdown.ts` launch and stop the Rust Sidecar. Backend credentials are generated per launch and logs use parent-owned pipes.
- `src-tauri/src/http_server/server_lifecycle.rs` invokes PTY cleanup during Sidecar shutdown. The source installer also stops matching Sidecar processes before replacing the app bundle.
- `src-tauri/src/pty_manager/` owns PTY masters, writers, readers, process identity, and terminal recovery machinery. Provider adapters prepare commands and environment values tied to the current host.
- `startup_resume.rs` consults persisted sessions and calls provider resume. It is cold recovery, not live attachment.
- Provider hooks and the installed CLI address the Sidecar's HTTP listener. Keeping a PTY alive without preserving that address and its acceptance semantics is insufficient.
- `taskTerminalTabsSession.ts` retains tabs in memory; renderer navigation includes session-scoped state. Neither is a durable restart workspace.
- Terminal coordination already checks PTY instances, replay positions, attachments, and geometry leases. `terminalSessionService.ts` selects xterm today, while the existing terminal coordination spec contains Ghostty-specific language. This change must preserve the selected renderer/authority's actual recovery contract rather than assuming a raw byte suffix is a complete terminal snapshot or switching renderers as part of daemon extraction.

The supported first implementation target is packaged macOS on arm64 and x64, matching the existing desktop release targets. Linux descriptor semantics inform the design but do not establish macOS acceptance evidence.

## Goals / Non-Goals

**Goals:**

- Put the PTY lifetime behind a small host interface that remains valid when the app and Sidecar are replaced.
- Activate a compatible daemon executable while sessions are live, rather than defer activation indefinitely.
- Keep domain persistence out of the daemon so replacing its executable does not also require migrating the Task database.
- Make restart identity, control ownership, recovery, and resource limits observable and independently testable.

**Non-Goals:**

- Preserving process memory across reboot, power loss, or destruction of every copy of a live PTY master.
- A background-running product mode after normal Quit, remote session migration, or arbitrary cross-version compatibility.
- An unlimited terminal transcript, replacing the terminal renderer, or changing provider conversation formats.
- Automatically replaying domain mutations or approving agent permissions while the desktop is unavailable.
- Preserving browser renderer processes, plugin runtime memory, devtools, or every unsaved UI draft. The required UI recovery is navigation and terminal tabs, not a checkpoint of the entire Electron app.
- Creating release discovery or a new update feed. This change owns restart coordination and integration with verified install targets. Missing production release verification remains a blocker for enabling that production update path, not permission to weaken verification.

## Decisions

### 1. Extract a Rust Session Daemon, not another domain backend

Introduce a separate executable and narrowly scoped protocol/client crates using the repository's backend-layout tooling. The daemon owns PTY masters, process-group supervision, ordered I/O, selected terminal recovery state, replay buffers, exit records, and a bounded ingress journal. The Sidecar owns SQLite, Task state, provider command preparation, permissions, and plugin business logic.

```text
[Electron + renderer] --> [Replaceable Sidecar]
                                  |
                         versioned local protocol
                                  |
                                  v
                       [Session Daemon]
                         |         |
                         v         v
                      [PTY A]   [PTY B]
                         |         |
                      [Agent]   [Shell + tools]

[Agent hooks / CLI] --> [Stable ingress in daemon]
                                  |
                         current ready Sidecar
```

The host interface groups operations around connect/reconcile, idempotent spawn, attach/recover, write/resize/terminate, and prepare/commit/abort replacement. It hides sockets, reexec details, process bookkeeping, and journal replay from callers. An in-process test adapter and real daemon adapter exercise the same contract. Avoid exposing existing `PtyManager` internals over RPC method by method.

Provider adapters build a validated command description in the Sidecar. The daemon launches it under the existing user, records ownership, and supplies stable task/session identity and agent-ingress credentials. The renderer continues through typed IPC wrappers and owner-scoped Terminal Runtime clients. Plugin and Companion terminal callers use the same host client rather than acquiring separate process ownership.

**Alternative:** keep the entire old Sidecar alive. Rejected because the user explicitly wants the Sidecar replaced immediately and its domain logic should not be held back by a long-running shell.

### 2. Gate production work on a real macOS reexec proof

Use in-place executable replacement as the initial design candidate. A successful `exec` preserves the daemon PID, parenthood of its children, and explicitly retained descriptors. It does not preserve Rust objects, threads, parsers, event loops, buffered userspace I/O, or arbitrary library state. Existing PTY library handles cannot be assumed reconstructible from raw descriptors.

The first implementation stage builds an isolated v1/v2 experiment. It must prove:

- PTY master and required listener/lock descriptors survive through an audited allowlist; unrelated descriptors and secrets are not inherited by agents or the target image.
- Reader, writer, terminal-model, and child-reaping activity reaches a coordinated checkpoint. Every accepted write is either drained before the checkpoint or explicitly retained once; no concurrent reader consumes bytes between checkpoint and replacement.
- Session metadata, partial protocol/parser state where applicable, terminal recovery state, image resources, output positions, exit records, and accepted hook records restore correctly. A screenshot or visible-screen-only snapshot is not proof of complete parser recovery.
- Child exit status remains observable when a child exits before, during, or after `exec`. Reaped exits are journaled; unreaped children remain collectable. Persisted process-start identity prevents PID-reuse mistakes.
- The daemon can rebuild its PTY control wrappers, event loop, and terminal protocol replies without respawning agents or sending duplicate replies.
- Failed preflight and failed `exec` return to v1. A controlled post-exec initialization error can reexec a retained compatible v1 image with the same descriptor inventory and state.
- The target actually runs v2 while agents and tools keep the same PIDs; repeated A-to-B-to-A compatible cycles work under output and input load.

The experiment must include interactive shells, alternate-screen applications, partial escape sequences, terminal queries, resize, retained images supported by the selected authority, hooks, and child exits. Measure the I/O pause and backpressure; do not claim uninterrupted service latency merely because processes survive.

**Stop rule:** if the experiment cannot preserve required state or supervision, or cannot meet the recoverable-error scenarios, stop before production extraction and revise this design with the owner. A spec file being complete is not evidence that reexec works.

**Alternatives:** descriptor transfer via `SCM_RIGHTS` permits a second daemon to receive PTY masters but does not transfer child parenthood, so it needs a supervision/reaping design. Per-session workers make daemon reconnection simpler but defer each worker's update; that changes the agreed live-host-update goal. Neither is an automatic fallback.

### 3. Separate identity from executable version

Use a stable installation data identity, a daemon lifetime identity, a monotonic controller generation, Shell Session Key, PTY instance ID, operation ID, and output cursor. Reexec changes executable version but preserves the daemon lifetime identity and live PTY identities. A genuinely new daemon lifetime is distinguishable even if numeric counters repeat.

Keep the existing Task/indexed-shell key model. Persist the next PTY instance allocation and spawn-operation deduplication state through reexec. Reconnection begins with authenticated inventory plus an event cursor; records after that cursor are replayed before domain reconciliation commits. This prevents an exit between inventory enumeration and subscription from disappearing.

A new Sidecar acquires exclusive mutation authority. Old controller commands and delayed completions are fenced even when the same PTY survives. Terminal view attachment and geometry ownership remain separate from Sidecar controller ownership. Cross-window clients cannot each assume they hold the current resize lease.

**Alternative:** use PIDs or a socket pathname as identity. Rejected because PIDs and filesystem entries outlive or can be reused independently of authenticated runtime ownership.

### 4. Stable discovery and narrow ingress live with the daemon

Run one daemon per user/app-data identity, detached from Electron's process group, with daemon-owned logs and no required parent stdout/stderr pipe. Use a private runtime directory, protected credentials, singleton ownership lock, and a versioned Unix-socket control endpoint. Authenticate peer/installation identity; socket permissions alone are not the entire authorization policy. Development and test app-data roots get separate sockets, ports, logs, credentials, and registries.

The existing agent-facing HTTP address becomes a narrow daemon ingress. The Sidecar listens privately and registers its current authenticated endpoint behind that ingress. The daemon forwards requests; it does not implement Task or plugin commands. Separate controller credentials from scoped agent-ingress credentials and do not weaken existing route authorization. Keep credentials out of argv, general metadata snapshots, diagnostics, and terminal replay.

For provider lifecycle notifications, persist an envelope containing a sender-generated notification ID, Task/session identity, ordering metadata, and bounded payload before acknowledging acceptance. The Sidecar transactionally records deduplication with the domain update and acknowledges the envelope afterward. Repeated delivery has no duplicate domain effect. Capacity exhaustion returns a failure instead of silently dropping acknowledged state.

Generated provider hooks must use bounded retry on transient ingress failures with a stable notification ID. Some current hooks are one-shot requests; keeping only the listening port stable is not enough during daemon reexec. Preserve the listening descriptor where proven, but close/retry active HTTP connections rather than pretend live HTTP parser state transfers automatically.

Request-response domain commands are not queued. Requests rejected before forwarding get an explicit retryable unavailable result. If a connection fails after forwarding a mutation, return outcome-unknown guidance rather than a promise that retry is safe. Frontend plugin commands remain unavailable until the trusted frontend is active. Permission prompts remain pending; no automatic approvals.

**Alternative:** rotate Sidecar tokens and expect existing agents to reload their environment. Rejected because running processes cannot receive replacement environment variables. Persisting an old token alone also does not retain notifications lost during downtime.

### 5. Treat replacement as a recorded transaction

Electron owns the user-facing restart/update coordinator and a durable operation record outside the replaceable app bundle. The source installer delegates to the same protocol. A small verified updater helper performs app replacement/relaunch after Electron exits; it does not own PTYs or decide domain recovery.

```text
running --> preparing --> detached --> replacing --> reconnecting --> committed
                |                         |               |
                v                         v               v
             aborted                 recovery required <--+
```

Preparation stages and verifies immutable target artifacts, checks the specific app/Sidecar/daemon/state-format transition, records the permitted rollback daemon image, saves workspace state, and drains or rejects conflicting mutations. The target Sidecar must support the retained daemon fallback version as well as the intended target version for the recovery plan to be usable.

After preparation, the daemon records the operation and grants handoff authority. Electron and the old Sidecar shut down domain/plugin resources without terminating daemon sessions. App replacement does not delete files referenced by a live executable, recovery image, or hook. If a daemon update is included, the daemon performs its checkpoint/reexec protocol. The new Sidecar then registers, reconciles inventory and notifications, and enables normal mutations. Electron restores the workspace and marks the operation committed only after readiness and version checks succeed.

Normal Quit is a different authenticated operation that terminates verified owned session process groups and the daemon. Generic shutdown hooks must read the operation intent; they must not turn an authorized update into `kill_all`. Failed readiness or expired attachment credentials require reauthentication and visible recovery, not automatic session termination. Provide an Electron recovery action and an authenticated local command for explicit Quit when the Sidecar is unavailable.

Timeouts bound waits, not session lifetimes. A failed relaunch can leave sessions running until the user retries or explicitly terminates them. This is recovery from an incomplete restart, not an additional normal-Quit background mode. A genuine cold start with no live daemon uses the existing provider-history eligibility path. During handoff, retained exits/completion records prevent that path from reviving a session that finished while the interface was absent.

### 6. Preserve the supported terminal recovery contract

Move PTY reads, ordered writes, retained byte replay, and any backend terminal-state workers into the daemon. Keep raw replay separate from canonical terminal state. Do not serialize pointers, Rust trait objects, or a bounded byte suffix and call it a portable parser checkpoint.

The selected terminal authority determines the representation. A reexec transition must preserve the recovery material that this renderer uses, including sequence positions and protocol-reply state, and must pass terminal conformance before support is advertised. If the selected authority needs a complete serializable checkpoint that is unavailable, the feasibility gate fails; switching to another renderer is a separate scope decision.

Define finite per-session replay, global replay, transition queue, and notification-journal budgets. Output retention can discard oldest history with an explicit gap marker; it must not fabricate full scrollback. Lifecycle records require durable acknowledgement handling and an explicit capacity failure. Geometry stays unchanged while no valid visible attachment owns a lease. Reconnection restores recovery state before newer live bytes and fences old controller, PTY, and attachment generations.

**Alternative:** rely exclusively on Electron's in-memory xterm instance or the Sidecar event stream. Rejected because both are replaced, and neither alone is an independent live PTY owner.

### 7. Store restart workspace separately from liveness

Add a versioned, atomically written workspace record in Electron user data scoped to installation identity and restart operation. Use stable window IDs, not Electron's transient native IDs. The schema stores navigation, Task/view identity, and tab index/key/label/order/selection/allocation state for known Tasks across participating windows. Do not store credentials, terminal output, or inferred process liveness here.

Hydrate domain data, validate destinations, reconcile saved tabs against the daemon, and then mount views. Preserve non-selected Tasks' tabs. Include legitimate daemon shells missing from the snapshot without reusing their indexes. An exited tab restores inactive with retained output; opening the view must not invoke default-shell creation first. Apply an idempotent restore generation so retries neither duplicate tabs nor overwrite newer user navigation. Mark the record consumed only after restoration succeeds; normal Quit clears obsolete restart intent without changing established ordinary launch behavior.

Keep persistence behind the host-owned tab/workspace interface, not ad hoc localStorage writes inside terminal components. The Terminal Runtime retains ownership of session coordination and onDestroy-based resource teardown. No prop-keyed effect cleanup may kill preserved resources.

### 8. Version runtime artifacts and constrain recovery claims

Install verified daemon binaries and required runtime assets in immutable versioned directories outside the app bundle before launch. Preserve referenced versions until no live daemon, reexec checkpoint, or recovery operation uses them. Package the daemon with the app and refresh the CLI without invalidating existing agents' stable ingress configuration.

Live-update metadata must declare supported protocol and state-format transitions. Validate the target image in an isolated preflight before the destructive exec point. Controlled new-image startup errors take the compatible fallback reexec path while descriptors remain open. The new image must not drop preserved resources before its final ready commit.

A successful exec destroys the old userspace image. SIGKILL, a loader failure that kills the process, or an arbitrary fatal crash before recovery code runs cannot be fixed by a metadata file. They are outside the continuity guarantee, and retained metadata is not advertised as a process checkpoint. If broader crash tolerance is required, the design needs another PTY-holding process and a new ownership review. Keep that limitation explicit in diagnostics and release documentation.

Do not automatically relaunch an older domain Sidecar after new database migrations. Daemon-only fallback is isolated from SQLite; app rollback remains a separate verified compatibility decision.

## Risks / Trade-offs

- [Reexec support in PTY/terminal libraries is incomplete] -> Prove raw descriptor reconstruction, state transfer, protocol replies, and cleanup behavior in the first stage; block production work on failure.
- [A paused daemon can fill kernel PTY buffers] -> Bound and measure the handoff pause under high output; reject unsafe preparation and never promise zero latency or zero backpressure.
- [New image dies after replacing the old image] -> Keep compatible recovery images and test controlled failures, but disclose fatal process-loss limits rather than claim universal rollback.
- [Two controllers race or stale commands arrive] -> Singleton installation lock, authenticated generation fencing, idempotent operation IDs, and inventory/event-cursor reconciliation.
- [Notifications duplicate or disappear] -> Durable accept-before-ack, sender IDs, transactional Sidecar deduplication, bounded retries, and explicit journal-exhaustion behavior.
- [An installer kills or deletes preserved resources] -> Replace process-name cleanup with verified ownership and reference-aware version cleanup; exercise packaged updates in isolated roots.
- [Renderer/authority documentation differs from implementation] -> Pin the exercised authority contract in the spike and reconcile relevant terminal documentation before shipping; do not silently widen this into renderer migration.
- [Unexpected app loss leaves a daemon behind] -> Expose recovery and explicit termination, never infer Quit from a broken connection. Test cleanup handles detached processes by ownership registry.
- [Protocol changes reach plugin or Companion consumers] -> Preserve public calls where possible and run SDK, desktop IPC, and Companion contract checks with full affected-subsystem validation.

## Migration Plan

1. Build the isolated reexec spike and record macOS arm64/x64 evidence. Stop if the design cannot meet the specs. Update the design with proven state formats and failure limits before production extraction.
2. Add the host protocol/client and daemon, keeping the existing path as a temporary development comparison only. Exercise both adapters through the same behavior contract.
3. Move all app-owned PTYs and their recovery/supervision into the daemon. Adapt provider starts, plugin shells, Companion terminals, completed replay capture, and process diagnostics. Remove production double ownership.
4. Move agent ingress to the stable gateway; ship notification retries/deduplication and CLI discovery together. Do not leave existing supported providers pointing at disposable endpoints.
5. Integrate durable restart intent, workspace capture/restore, Sidecar reconciliation, and authenticated normal Quit. Introduce an explicit Restart action and connect verified update/source-install paths.
6. Package versioned runtime artifacts and enable live daemon replacement only for tested transitions. Exercise update, repeated restart, refusal, recovery, and normal-Quit cases in isolated packaged builds.
7. Initial adoption from today's build requires explicit interruption approval because those PTYs were created under the old Sidecar. Do not attempt to retrofit them by guessing descriptors from PID files.
8. For pre-commit replacement failures, retain or restore the old installed bundle as supported by the installer. After a new domain database migration, keep the new app in recovery rather than automatically reverting its Sidecar. Sessions remain available for compatible reattachment or explicit termination.

Validation during implementation is full affected-system validation: desktop tests/type/lint, the terminal runtime and affected SDK/plugin packages, both Rust hosts and new protocol crates, cross-boundary contracts, conformance, and isolated macOS packaged update tests. Performance and shutdown tests must use explicit owned runtime roots; never restart or install over the developer's active OpenForge session as a test.
