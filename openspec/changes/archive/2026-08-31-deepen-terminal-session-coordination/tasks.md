## 1. Lock the Terminal Runtime contracts with tests

- [x] 1.1 Add failing Terminal Runtime contract tests for opaque `TerminalSession` acquisition, the absence of exported mutable `PoolEntry` state, and read-only lifecycle access; verify the focused contract and package-boundary tests fail for the expected missing interface with `pnpm exec vitest run --config packages/terminal-runtime/vitest.config.ts packages/terminal-runtime/src/terminalRuntimeContract.test.ts packages/terminal-runtime/src/packageBoundary.test.ts`
- [x] 1.2 Add failing integration tests for a generation-bound PTY spawn lease, including one pending lease, idempotent cancellation, matching-instance completion, and rejection of pending output from another instance; verify the focused spawn and shell-lifecycle tests fail for the expected missing behavior
- [x] 1.3 Add failing integration tests for attachment-owned refitting and Terminal Geometry Lease rejection of stale, hidden, and detached callbacks; verify the focused attachment-generation and resize tests fail for the expected missing attachment interface
- [x] 1.4 Add failing integration tests for a read-only runtime diagnostics interface covering lifecycle, authority watermark, output observation, geometry, presentation capture, and presentation drain without pool mutation access; verify the focused diagnostics and sequencing tests fail for the expected missing interface

## 2. Add the per-session coordinator

- [x] 2.1 Create `terminalSessionCoordinator.ts` with closure-private session state, opaque session identity, transport subscription, view input forwarding, lifecycle observation, and rollback-safe startup; verify acquisition rollback, concurrent acquisition, and clean retry integration tests pass
- [x] 2.2 Implement PTY selection and spawn-lease transitions so instance changes reset instance-scoped watermarks and output observations, stale lease completion is harmless, and eligible pending output waits for authority; verify the new spawn tests and `terminalRuntimeShellLifecycle.integration.test.ts` pass
- [x] 2.3 Move Ghostty replay, snapshot-watermark, contiguous live-output, bounded pending-output, stale-instance, and single-flight recovery logic into the coordinator; verify `terminalRuntimeSequencing.integration.test.ts`, `terminalSnapshotOrdering.integration.test.ts`, `xtermTerminalStateReplacement.integration.test.ts`, and reconnect stale-instance tests pass
- [x] 2.4 Move attachment generation, visibility generation, model-output suspension, visible recovery retries, fit retry cancellation, and Terminal Geometry Lease checks into the coordinator; verify the attachment, attachment-generation, visibility, and resize integration suites pass
- [x] 2.5 Implement coordinator reset, focus, refresh, detach, and deterministic disposal without changing PTY liveness; verify disposal, shell lifecycle, and attachment cancellation integration tests pass

## 3. Rewire Terminal Runtime modules

- [x] 3.1 Change `terminalAcquisition.ts` to register and return opaque sessions while its registry owns coordinators, including pending release and initialization rollback paths; verify the full acquisition and reconnect-listener rollback integration suites pass
- [x] 3.2 Narrow `terminalSessionLifecycle.ts` to pending restored-instance metadata, keyed lifecycle delegation, and task-tab storage without direct session mutation; verify its unit tests and Terminal Runtime shell-lifecycle integration suite pass
- [x] 3.3 Change `terminalReconnectReplay.ts`, theme propagation, reset, focus, release, and runtime disposal to call coordinator operations without inspecting session state; verify reconnect replay, configuration, theme, and disposal integration suites pass
- [x] 3.4 Replace runtime setter sequences with `beginPtySpawn`, attachment capabilities, opaque session operations, and read-only diagnostics; verify `terminalRuntimeContract.test.ts`, `terminalSessionClientContract.integration.test.ts`, and package-boundary tests pass

## 4. Migrate workspace consumers

- [x] 4.1 Update task terminal controllers and adapters to use opaque sessions, spawn leases, and attachment capabilities rather than `PoolEntry` fields; verify `taskTerminalController.test.ts`, `TaskTerminalSurface.test.ts`, task-pane lifecycle tests, and task terminal tab tests pass
- [x] 4.2 Update `AgentTerminalShell.svelte` and related desktop tests to use `TerminalViewAttachment.refit()` and runtime lifecycle observations instead of direct Terminal View access; verify the focused agent terminal and task detail tests pass
- [x] 4.3 Update `TerminalSessionService`, desktop terminal facades, and the Terminal plugin facade and surfaces to use the new runtime types and operations while preserving owner-scoped release; verify `terminalSessionService.integration.test.ts`, desktop terminal pool tests, and `pnpm --filter @openforge-app/plugin-terminal test` pass
- [x] 4.4 Replace `_getPool` and `getTerminalEntriesForObservation` consumers with read-only diagnostics in terminal test probes, full-app performance support, and conformance helpers; verify terminal test probe tests and conformance recorder and registry tests pass
- [x] 4.5 Replace tests that construct or inspect partial `PoolEntry` records with runtime fakes, coordinator test support, view observations, transport observations, lifecycle snapshots, or diagnostics; verify no test outside dedicated test support imports `PoolEntry` and the terminal-runtime suite passes

## 5. Remove the shared mutable seam

- [x] 5.1 Remove the exported `PoolEntry` interface, `_getPool`, direct Terminal View access, and obsolete runtime mutator methods after all callers migrate; verify `rg "PoolEntry|_getPool|updateShellLifecycleState" packages/terminal-runtime src plugins/terminal` returns no production references
- [x] 5.2 Remove stateful `terminalStateView.ts` and `terminalAttachment.ts` code after moving their behavior, retaining only focused pure helpers such as dimension validation where useful; verify package build succeeds and no orphan imports or duplicate coordination state remain
- [x] 5.3 Review the coordinator interface for methods that expose transition ordering or raw mutable state, remove pass-through operations, and verify all callers use semantic session, attachment, spawn-lease, lifecycle, or diagnostics operations

## 6. Validate affected systems

- [x] 6.1 Run the full Terminal Runtime checks with `pnpm --filter @openforge-app/terminal-runtime test`, `pnpm --filter @openforge-app/terminal-runtime build`, and `pnpm --filter @openforge-app/terminal-runtime conformance`; verify all commands pass without updating conformance baselines
- [x] 6.2 Run Terminal plugin validation with `pnpm --filter @openforge-app/plugin-terminal test` and `pnpm --filter @openforge-app/plugin-terminal build`; verify its host-injected session client compiles and all plugin tests pass
- [x] 6.3 Run desktop and workspace validation with `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, and `pnpm build`; verify all tests and static checks pass
- [x] 6.4 Run the full-app terminal performance scenario from `docs/desktop-terminal-testing.md`, compare startup, sustained output, recovery, and teardown evidence with the checked-in baseline, and record any environment-dependent gap without changing performance baselines

  Observed on the implementation worktree: shell ready 11,339.8 ms; painted echo median 173.5 ms and p95 182.2 ms; PTY output 48,133 B/s for 262,144 bytes; view recovery 116.4 ms. Process-tree RSS changed from 1,053,523,968 to 1,067,089,920 bytes and JavaScript heap from 60,710,202 to 68,545,891 bytes. The scenario's correctness evidence passed. No checked-in machine-equivalent timing or memory baseline was available, so environment-sensitive metric regression could not be quantified.
