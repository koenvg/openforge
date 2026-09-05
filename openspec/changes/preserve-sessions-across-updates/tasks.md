## 1. Blocking macOS feasibility proof

- [ ] 1.1 Define an isolated v1/v2 reexec experiment and acceptance matrix covering each live-replacement spec scenario; verify the fixture design records app-data isolation, process ownership, target versions, PTY identities, output cursors, and explicit cleanup without touching the active OpenForge app.
- [ ] 1.2 Build a minimal PTY-owning experiment with failing continuity assertions first, then retain an audited descriptor set across executable replacement; verify unchanged shell/agent/tool PIDs, input echo, resize, and a genuinely active v2 executable on macOS.
- [ ] 1.3 Add checkpoint/recovery experiments for the selected terminal authority, partial escape sequences, alternate screen, protocol replies, supported images, ordered writes, and bounded replay; verify numbered output and terminal conformance across replacement without handoff-induced loss or duplicate replies.
- [ ] 1.4 Exercise child exits before, during, and after reexec and process-group cleanup; verify exit status retention, eventual reaping, PID-reuse protection, and no surviving fixture descendants after explicit termination.
- [ ] 1.5 Inject incompatible state, invalid executable, failed exec, controlled post-exec initialization failure, and concurrent I/O; verify refusal or same-session recovery, measure pause/backpressure, and document fatal process-loss cases that cannot recover.
- [ ] 1.6 Run the experiment on macOS arm64 and x64 and record commands and evidence in a feasibility report; verify every required scenario passes before proceeding to section 2, update design.md with proven state/descriptor contracts, and stop for owner review if the candidate fails rather than silently switching to workers or descriptor transfer.

## 2. Host protocol and ownership

- [ ] 2.1 Add the Session Daemon executable and protocol/client crate layout using backend-layout tooling; verify each new crate builds independently and dependency checks show the daemon does not import Task/database or plugin business logic.
- [ ] 2.2 Define versioned connect/inventory, spawn, attachment/recovery, I/O, termination, and replacement contracts; write contract tests first and verify request validation, bounded frames, unknown versions, identity fields, and explicit error categories.
- [ ] 2.3 Add installation-scoped runtime discovery, protected credentials, singleton lock, detached process group, and daemon-owned logs; verify duplicate launch, stale socket, forged identity, foreign user, and isolated app-data tests without taking over unrelated processes.
- [ ] 2.4 Implement exclusive controller generations and persisted daemon/PTY allocation identity with tests first; verify stale controller mutations are rejected while surviving PTY identities remain unchanged across handoff.
- [ ] 2.5 Implement idempotent spawn and inventory/event-cursor reconciliation through real and test adapters; verify lost spawn replies do not duplicate children and an exit racing with inventory cannot disappear.

## 3. Extract PTY ownership from the Sidecar

- [ ] 3.1 Move PTY creation and process supervision behind the host interface with behavior tests first; verify all supported providers and indexed shells launch under the daemon and preserve existing command, cwd, environment, permissions, and terminal-image behavior.
- [ ] 3.2 Move ordered input, output positions, recovery state, and backend terminal workers into the daemon; verify existing terminal recovery/conformance suites plus host tests for input ordering, protocol replies, and retained replay.
- [ ] 3.3 Add bounded per-session/global replay, exit retention, and explicit gap/capacity diagnostics; verify output and exit bursts stay within documented budgets and consumers distinguish truncated history from live state.
- [ ] 3.4 Adapt Sidecar PTY commands and provider orchestration to the host client; verify start, write, resize, terminate, completed replay capture, and memory diagnostics use the daemon and preserve existing public command behavior.
- [ ] 3.5 Adapt plugin shell callbacks and Companion terminal consumers to the same ownership model; verify package/host contract tests and Companion terminal tests do not create another PTY owner.
- [ ] 3.6 Remove production Sidecar ownership and replace unconditional PTY cleanup with intent-aware host operations; verify Sidecar replacement preserves sessions and scoped Task/terminal stop still terminates only the intended process groups.

## 4. Stable agent ingress and notification recovery

- [ ] 4.1 Add a stable installation-scoped agent HTTP gateway in the daemon and private Sidecar endpoint registration; write tests first and verify existing agent addresses remain usable after Sidecar replacement without changing agent environment variables or weakening route authorization.
- [ ] 4.2 Separate agent and controller credentials and validate Task/PTY identity on ingress; verify malformed, oversized, forged, stale-instance, and foreign-installation requests are rejected and secrets do not appear in diagnostic output.
- [ ] 4.3 Add bounded durable notification acceptance and Sidecar acknowledgement/deduplication storage with migration tests first; verify accept-before-ack, process replacement, repeated delivery, transactional domain updates, and full-journal rejection.
- [ ] 4.4 Update generated hooks for Pi, Claude Code, Codex, OpenCode, and Grok to send stable notification IDs and bounded retries; verify provider contract fixtures cover completion, input/permission waiting, disconnection, duplicate delivery, and exhausted retries.
- [ ] 4.5 Implement explicit unavailable/not-executed and outcome-unknown command responses without mutation replay; verify commands during backend downtime are not queued and a dropped forwarded mutation is not executed again automatically.
- [ ] 4.6 Adapt CLI discovery and frontend plugin availability handling; verify an already-running agent can call the refreshed CLI after restart, frontend-only commands fail explicitly while the renderer is absent, and no permission request is automatically approved.

## 5. Restart transaction and Sidecar reconciliation

- [ ] 5.1 Implement durable restart/update/Quit intent and serialized operation states with tests first; verify duplicate requests, cancellation before detach, interrupted operation loading, and stale operation rejection.
- [ ] 5.2 Implement preflight checks for verified artifacts, app/Sidecar/daemon/state compatibility, recovery image support, and required workspace capture; verify each failed prerequisite leaves the running app and sessions untouched.
- [ ] 5.3 Add prepare/drain/fence behavior for concurrent spawns and mutations; verify every racing start is either included in the preserved inventory or rejected as not executed, never reported successful and omitted.
- [ ] 5.4 Change Electron boot/shutdown to reconnect through authenticated daemon ownership and use distinct restart intent; verify explicit Restart replaces Electron and the Sidecar without invoking normal-Quit PTY cleanup.
- [ ] 5.5 Reconcile live inventory, retained exits, and lifecycle notifications before startup history recovery; verify stale database state cannot cause duplicate agents and completion or permission-waiting during downtime restores correctly.
- [ ] 5.6 Add recovery UI and an authenticated local termination command usable without a healthy Sidecar; verify relaunch timeout and failed Sidecar boot retain sessions, retry can reattach, and explicit normal Quit cleans verified owned processes only.
- [ ] 5.7 Preserve cold-start eligibility and disclose first-adoption interruption; verify reboot/no-daemon fixtures use history recovery, retained handoff exits do not trigger resume, and upgrading a pre-daemon build cannot silently interrupt active sessions.

## 6. Workspace restoration and terminal coordination

- [ ] 6.1 Add a versioned atomic restart-workspace record scoped to installation, operation, and stable window identity; write persistence tests first and verify navigation/tab serialization, corrupt or incompatible records, write failure, and exclusion of credentials/output.
- [ ] 6.2 Add host-owned tab snapshot/hydration operations to the Terminal Runtime integration; verify labels, order, active selection, non-selected Tasks, and next-index state round-trip without direct component-owned lifecycle mutations.
- [ ] 6.3 Restore validated project/Task/view navigation after domain hydration; verify deleted/hidden/unavailable destinations fall back safely and late restoration cannot overwrite newer user navigation.
- [ ] 6.4 Reconcile saved tabs with daemon inventory before any default-shell spawn; verify surviving cwd/environment, exited tabs, shells missing from the snapshot, and collision-free creation of subsequent tabs.
- [ ] 6.5 Add controller-generation guards to terminal attachment/recovery and geometry operations through typed IPC wrappers; verify stale replay/resize rejection, unchanged live PTY identity, bounded queues, output joining, and inactive input during reconciliation.
- [ ] 6.6 Make restoration retries and multi-window attachment idempotent; verify no duplicate tabs/shells, one current geometry owner, record consumption after success, and no stale restart workspace overriding a later normal launch.

## 7. Production live daemon replacement

- [ ] 7.1 Implement the proven checkpoint format and quiescence barrier from section 1 with tests first; verify descriptor inventory, readers/writers, accepted input, event records, terminal state, output cursors, and child-reaping state reach a consistent replacement point.
- [ ] 7.2 Implement compatible image preflight and live reexec using the proven low-level PTY reconstruction path; verify the new executable serves existing agents immediately with unchanged PTY identities and without waiting for sessions to end.
- [ ] 7.3 Implement controlled failed-exec and post-exec fallback recovery while retained descriptors remain open; verify fallback image compatibility, recovery before ready commit, and explicit reporting that the attempted update did not complete.
- [ ] 7.4 Preserve gateway listener/discovery identity and notification acceptance across daemon replacement; verify hook retries and deduplication, request outcome reporting, protected credential continuity, and reconnecting Sidecar registration.
- [ ] 7.5 Integrate daemon activation with the app restart transaction; verify commit checks all target versions and restoration readiness, while unsupported transitions and failed daemon activation never silently become idle-only updates.

## 8. Packaging, installation, and owned cleanup

- [ ] 8.1 Package verified versioned daemon binaries and runtime assets outside replaceable app resources while live; verify packaged path resolution and that replacing the app bundle does not remove current/recovery images, required assets, or hook files.
- [ ] 8.2 Add the verified updater helper and integrate source installation with the restart protocol; verify isolated install tests preserve active sessions, restore the old bundle on supported pre-commit replacement failures, and never use blanket process-name kills for daemon cleanup.
- [ ] 8.3 Integrate the explicit Restart action and available coordinated update entry points without adding release discovery; verify user-visible progress, refusal, recovery, and explicit interruption approval for first adoption. Keep production update enablement blocked if its trusted-release verification prerequisite is unavailable.
- [ ] 8.4 Refresh CLI payloads and retain runtime versions referenced by live/recovery state; verify existing agents still reach the gateway, cleanup removes only unreferenced owned artifacts, and incompatible domain database rollback is not attempted.
- [ ] 8.5 Extend isolated desktop lifecycle ownership registries to track detached daemons and descendants; verify normal teardown, failed startup, reuse mode, and timeouts clean only owned fixtures and never touch the developer's active app.

## 9. Full affected-system validation and release evidence

- [ ] 9.1 Add isolated packaged end-to-end tests for app restart, Sidecar replacement, and live daemon update with active agent/tool/shell fixtures; verify unchanged agent/tool PIDs, target executable versions, input/resize, ordered output, exit reporting, and restored Task/tab state on macOS arm64 and x64.
- [ ] 9.2 Extend cross-process fault tests for repeated compatible upgrades, high output, retained images, partial terminal sequences, controller races, completion/permission notifications, journal exhaustion, delayed relaunch, and explicit Quit; verify all four delta specs have mapped evidence and retain logs with secrets redacted.
- [ ] 9.3 Run full desktop checks using `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm electron:contract:check`, and `pnpm mobile:contract:check`; verify passing output or document exact blockers. Run additional Companion app checks if its Dart code changes.
- [ ] 9.4 Run affected workspace checks: terminal-runtime test/build/conformance, plugin-sdk test/build/check:contract/check:entrypoints, terminal plugin test/build, and every test/static-check script of any other package or plugin changed by the complete diff; verify package contract coverage and disclose any missing package-local scripts.
- [ ] 9.5 Run `cargo test`, `cargo check`, `cargo build`, and `cargo clippy` for the backend and every added protocol/client/daemon crate using resolved manifest paths; verify cross-host tests, serialization compatibility, descriptor safety, and required formatting checks all pass.
- [ ] 9.6 Run isolated packaged smoke, live Electron invariant, terminal conformance, and resource checks following the repository guides; verify bounded memory/journal/replay use, measured restart pause, no regressions against established terminal budgets, and no leaked owned processes. Do not run `pnpm electron:install` against the active development app as a test.
- [ ] 9.7 Document the proven ownership/upgrade decision, supported transition matrix, terminal authority recovery limits, first-adoption interruption, normal-Quit behavior, and failed-restart recovery; verify domain terms and affected shutdown/installer/testing documentation match the implementation without absorbing unrelated CLI documentation cleanup KVG-4709.
- [ ] 9.8 Re-run strict OpenSpec validation and reconcile this checklist with the complete task diff; verify no unchecked feasibility or required platform evidence is reported as completed, and update task-scoped Handoff Notes with final user-facing outcomes and remaining blockers.
