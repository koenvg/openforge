## 1. Domain and key contract

- [x] 1.1 Add Session Scope, Scoped Agent Session, Scoped Workspace, and Session Tool Policy to `CONTEXT.md`, revise Agent Session ownership, and add the agreed relationships; verify the terms match the OpenSpec design and no existing Implementation Run statement becomes non-Task-scoped
- [x] 1.2 Add shared Session Scope structural validation and canonical length-prefixed encoding with the 128-byte namespace, 2,048-byte target key, and 256-byte revision limits; verify unit tests cover exact equality, empty and oversized fields, NUL, Unicode byte length, and delimiter-like content
- [x] 1.3 Implement `scoped-agent-v1-<sha256>` construction and parsing in the Terminal Runtime and Rust host, reserve that grammar in backend Task-prefix validation, and preserve both existing key shapes; verify shared fixture vectors, migration preflight, direct config writes, round trips, rejection cases, existing parser tests, and digest-collision failure all pass
- [x] 1.4 Reconcile the third key kind with `preserve-sessions-across-updates` across daemon protocol, inventory, PID ownership, diagnostics, Task cleanup, and restart workspace validation; verify restart tests terminate or quarantine scoped keys without restoring them or treating them as Task agents

## 2. Scoped Workspace ownership

- [x] 2.1 Add `scoped_workspaces` storage and migrations without changing `task_workspaces` or `worktrees`; verify migration and upgrade tests assert the new constraints, lookup indexes, cleanup state, and unchanged Task tables
- [x] 2.2 Implement Project and checkout-revision resolution, staged detached-worktree creation, publication, and same-scope reuse; verify tests prove a later turn reuses the same resolved commit and callers cannot provide an arbitrary path
- [x] 2.3 Implement revision rotation, explicit release, plugin-deactivation cleanup, startup orphan cleanup, and retryable `cleanup_pending`; verify tests cover successful removal, failed deletion retry, and no partial directory or row after fetch, resolution, checkout, measurement, or publication failure
- [x] 2.4 Enforce the 32-workspace and 20-GiB retained-data limits with logical-byte measurement and least-recently-used inactive eviction; verify tests cover count eviction, byte eviction, recreation at the stored commit, oversized single checkout rejection, pending-cleanup accounting, and refusal when only protected workspaces remain

## 3. Scoped Agent Session lifecycle and policy

- [x] 3.1 Add `scoped_agent_sessions` storage, scope ownership, revision rotation, typed statuses and errors, and lookup methods without changing `agent_sessions`; verify database tests cover exact scope matching, cross-plugin refusal, duplicate live start, state transitions, and Task-session isolation
- [x] 3.2 Implement the host-wide four-slot scoped scheduler and 32-entry FIFO queue, including queued abort and promotion; verify deterministic tests cover queue position, fifth-session visibility, FIFO advancement, full-queue rejection, and no provider process or workspace while queued
- [x] 3.3 Launch a scoped provider in its Scoped Workspace from Project Agent Settings, persist provider conversation identity, deliver input to a live process, resume a completed conversation with a new PTY instance, and abort the owned process group; verify tests cover start, running input, completion, continuation, stale-instance filtering, abort, retained output, and 64-KiB input rejection
- [x] 3.4 Add scope-bound agent credentials and route authorization that derives plugin, session, and scope from host identity rather than request input; verify tests reject another scope, another plugin, revoked credentials, and a Task-only route while permitting named scope-bound review routes
- [x] 3.5 Add the host-owned `review-read-only` Session Tool Policy for Claude Code using isolated settings, immutable deny rules, and a final pre-tool authorization hook; verify integration tests prove direct edits, unrestricted shell, metacharacter injection, and approved mutations remain denied while permitted reads and scope-bound Review Thread commands work
- [x] 3.6 Exclude scoped rows from Task status, Focus, Task Attention, In-Flight Tasks, Task completion, task-scoped listing, startup resume, and restart preservation; verify the nearest projection and lifecycle tests remain unchanged and scoped restart records become `interrupted`

## 4. Public Plugin SDK and terminal mount

- [x] 4.1 Add typed scope, state, error, start, status, input, abort, release, and invalidation contracts to the common Agent Sessions API while preserving `agentSessions.list()`; verify SDK contract tests assert Task-only list results and exact scope filtering for every new operation
- [x] 4.2 Route the new operations through frontend and backend hosts, typed desktop IPC, Rust command boundaries, and the packaged plugin-host runtime with camelCase frontend payloads and `Result<T, String>` command results; verify host-routing, generated registry, and packaged-runtime contract tests pass
- [x] 4.3 Implement matching CommonAPIFake lifecycle, ownership, four-slot execution, 32-entry queue, abort, release, and invalidations with deterministic completion controls; verify fake contract tests run the duplicate-scope, fifth-session queue, promotion, full-queue, and unrelated-scope cases
- [x] 4.4 Add the frontend-only `mountTerminal(scope, element)` attachment backed by the host Terminal Runtime and an owner-scoped client; verify component and integration tests cover live output, retained final output, resize and input, one current attachment, generation-safe replacement, and no terminal internals in the plugin contract
- [x] 4.5 Keep lifecycle ownership out of prop-keyed `$effect` cleanup, compare Session Scope identity explicitly, and dispose only the current view attachment from `onDestroy`; verify rerender and stale-disposer tests prove a mount change cannot abort, release, detach, or resize its replacement
- [x] 4.6 Document scoped session operations, policy names, queue and workspace limits, mount disposal, and typed errors in plugin authoring docs; verify SDK fixtures compile against frontend, backend, testing, generated declarations, and packed entry points

## 5. Integrated validation

- [x] 5.1 Run focused red-green tests for each behavior above, then run `pnpm packages:test`, `pnpm packages:build`, `pnpm packages:contract:check`, `pnpm electron:contract:check`, the affected renderer and Electron tests, and the Plugin SDK runtime build test; verify every command passes and generated contracts are clean
- [x] 5.2 Run the full Backend Crate tests from the path returned by `node scripts/rust-sidecar-layout.mjs backend-crate-root`, plus affected session-daemon protocol and integration tests; verify migrations, policy enforcement, scheduler concurrency, process cleanup, workspace eviction, key parsing, and restart exclusion pass
- [x] 5.3 Run `pnpm lint` and the affected desktop static checks, then record the complete validation scope and any platform-only gap; verify no untested gap remains across the database, IPC, SDK, terminal, concurrency, lifecycle, or restart boundaries changed by this work
