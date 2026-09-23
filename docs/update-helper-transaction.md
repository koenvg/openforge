# Disabled updater checkpoint

KVG-5206 is an implementation checkpoint, not an enabled session-preserving updater. The owner approved landing the groundwork with update entry points disabled. The local update menu, published updates, legacy first adoption and source installation remain disabled. Ordinary Restart and Quit retain their separate policies.

The intended first update path is explicit local approval between compatible, daemon-aware macOS arm64 installations. A source must report an armed parent-exit guard and supply its actual data roots and authenticated daemon controller. The guard capability is not proof of the original app or Sidecar's identity or exit. Other architectures and platforms are not update acceptance targets for this checkpoint.

## Implemented boundaries

### Authorization and preparation

- Complete-app staging measures Electron, Sidecar, daemon, CLI, helper, resources, permissions and internal links. Electron uses `original-fs` so ASAR files are measured as raw bytes. Escaping links and incomplete bundles are refused.
- Published artifacts require the installed publisher trust anchor. Local approval is separate, explicit and bound to immutable bytes, installation, destination and operation. Failed publisher verification never falls back to local approval. First-adoption interruption consent is another authority; its implemented grant format does not enable legacy installation.
- Electron durably records the selected target, controller and roots before native preparation, backend preparation and workspace capture. Controller authority is copied before asynchronous work.
- A privately copied, hash-checked helper uses inherited pipes, a fresh challenge and domain-separated HMACs. Handshake version 2 advertises `relaunch`, `launch-gate` and `atomic-replace`; authenticated request, grant and journal formats remain version 1.
- Installation ownership is serialized by kernel locks and a permanent canonical destination/recovery-root binding. Replay tombstones, complete-byte remeasurement and private-directory checks survive process loss.
- Preparation becomes uncertain before sending a request. Only a typed, provably unsent failure after owned-helper cleanup can clear that uncertainty. Lost prepare, cancel or arm acknowledgements are not successful cancellation.

### Replacement and runtime ownership

- The coordinator requires authenticated detach and observed exit of its exact owned Sidecar. The helper independently observes its actual Electron parent through the kernel. A signal acknowledgement, `killed`, EOF or a shutdown report is not exit proof.
- `MaintenanceClient` borrows the supplied controller without connecting a new controller or launching a daemon. Runtime preparation retains complete daemon/CLI assets with durable release references. Cold preparation reserves both launch and lifetime locks rather than inferring absence from missing discovery files.
- macOS publication uses atomic directory exchange, not removal followed by rename. The journal records the exchange location before publication. Recovery validates canonical staging and exchange paths and the retained source bytes; a redirected staging symlink cannot supply rollback authority.
- Before restoring the source or newly recording rollback for a live-runtime operation, recovery independently checks the original controller, daemon PID, source version and loaded code, plus a matching terminal abort/failure receipt. An activated or unknown runtime outcome cannot authorize rollback. An already-recorded rollback acknowledgement still rechecks restored source bytes.
- If activation succeeds but its acknowledgement is lost, the installed target stays in place. That is forward-only uncertainty, not a successful cancellation. Forward recovery from Installed without a recorded app launch remains an activation gate.

### Launch, readiness and restoration

- A bootstrap execution gate records the launch owner before spawn, then records the child's kernel birth identity and fresh challenge before releasing app execution. Missing birth evidence remains unknown. The narrow abandoned-gate exception requires independently verified owner exit and proof that execution authority was never released.
- Electron authenticates native launch before creating a Sidecar. Sidecar admission checks its own birth, parent, executable, operation, roots, grant, installed bytes and runtime receipt before keychain or domain/database initialization. Flags alone grant no authority.
- Electron, Sidecar and readiness checks compare authorized code signatures with kernel-loaded CDHashes. Restoring bytes on disk or keeping the PID/birth across `exec` cannot retain authority for another running image.
- Readiness independently verifies the admitted Sidecar and daemon/controller/image. Live readiness requires the preserved daemon PID/lifetime, a newer controller and the activated target receipt. Cold fixture readiness binds the installation and daemon parentage. The production local driver requires a live authenticated controller; cold native relaunch without a retained live-runtime plan refuses.
- Every replacement app lifetime restores and acknowledges its own windows. Retained snapshots do not carry predecessor acknowledgements into a new launch. Native commit precedes backend commit so an uncertain native result cannot enable ordinary Quit cleanup.
- A fresh matching backend update startup reopens restoration fencing for a committed update. Same-transport retries do not. The existing restart environment context is not new native authentication; no conditional Connect/CAS or native-verified backend startup-context API is claimed.

### Process loss and recovery

- macOS Electron-owned Sidecars arm the kernel parent-exit guard before domain startup, including ordinary source Sidecars. Parent loss uses `_exit` and bypasses Quit cleanup. Ownership mode does not grant update admission. Standalone and non-macOS ordinary startup remain unchanged.
- Failed admitted update children are retired through their captured child handle and observed exit, without falling back to ordinary SIGTERM/Quit cleanup. An unadmitted source Sidecar is observed, not signalled by update recovery.
- Native relaunch uses fresh challenge/HMAC authority and waits for the actual requester to exit. Requester preparation does not grant target startup authority. Cancellation and pre-authority EOF cannot launch or commit.
- Update recovery is separate from ordinary restart recovery and its CLI. The native dialog offers Retry, Close app and leave sessions running, and Keep waiting. Keep waiting is the default and Escape action. Failed verification is displayed without ordinary `app.relaunch()`, rollback or session termination fallback.
- `LocalUpdateDriver.recover()` supports installed-target post-launch recovery. Original source birth/exit attestation, preparation-loss recovery and forward Installed/no-launch recovery are not complete. They remain required before activation.

Recovery, authorization and staging storage must be outside both replaceable bundles. Destination, staging and recovery must share the installation filesystem. A journal or retained image cannot recover live PTYs after fatal loss of their sole owning process.

## Packaging and ordinary-startup evidence

Packaging now seals nested code bundles before the outer app and verifies the result with strict code-signature checks. It does not deep-sign arbitrary retained executables or rewrite daemon manifest hashes. Ad-hoc sealing proves local integrity, not publisher trust or notarization.

Runtime and plugin-host resources live under `Contents/Resources/session-runtime` and `Contents/Resources/plugin-host`; the CLI payload is under `Contents/Resources/openforge-cli`. Mach-O entry points remain under `Contents/MacOS`.

The disabled checkpoint was rebuilt from current source on macOS arm64 using the packaging orchestration's layout injection and the private backend target. Output:

```text
src-tauri/target/backend-update-contract/release/bundle/checkpoint-8976dc86c/Open Forge.app
```

Evidence:

- Strict verification passed for the whole app, Electron executable, Sidecar, daemon and helper. All four entry points report arm64.
- All 16 retained runtime manifest entries match their hashes. The retained daemon is byte-identical to the packaged daemon entry point. The obsolete `MacOS/session-runtime` and `MacOS/plugin-host` directories are absent.
- Isolated packaged ordinary startup exposed the sandbox preload and completed `get_projects`, returning an empty array from its private database. Authenticated fixture cleanup completed. Its retained private evidence root is `/tmp/of-packaged-smoke-8fSLT6`.
- The packaged plugin host answered `plugin.host.diagnostics` through the bundled Electron Node runtime with a system-only PATH, without Bun or a repository entrypoint override.
- The release-mode packaged-runtime contract used this app's actual runtime payload. It passed staged launch, temporary source-bundle removal, untrusted replacement refusal, shell PID/PTY preservation and authenticated owned cleanup.

These checks establish package integrity and ordinary startup. They do not establish a complete packaged app update with agents, tools and multi-window restoration. KVG-4730 retains that acceptance gate. The app was not installed over the developer's application.

## Validation at the disabled checkpoint

Review baseline: `8976dc86c`, the rebased equivalent of the earlier `e7e79196d` checkpoint. Commands use normal test parallelism and strip inherited `OPENFORGE_*` settings. Backend validation uses `src-tauri/target/backend-update-contract`, not another worktree's shared cache.

| Check | Result |
| --- | --- |
| Root desktop tests | 896 files passed; 7,678 tests passed, 3 expected failures and 96 skips across 18 skipped files |
| TypeScript, plugin-host types, lint, Electron/Companion contracts, SDK package contract | Passed |
| Native Electron/helper install and recovery contracts | 21 passed |
| Packaging/integrity contracts | 20 passed across 2 files |
| Helper default / all-feature tests | 25 / 39 integration tests, plus 1 doctest each |
| Backend default / all-feature tests | 2,407 passed and 54 ignored each |
| Explicit Sidecar / daemon IPC / committed-update reconnect contracts | 27 / 10 / 1 passed |
| Session Protocol default / all-feature tests | 11 / 11 passed |
| Session Host default / all-feature tests | 17 / 17 passed |
| Session Client default / all-feature tests | 19 / 19 passed |
| Session Daemon default / all-feature tests | 95 / 296 reported cases, with 2 / 5 ignored; binary targets repeat unit tests |
| Helper, backend, host, client and daemon check/build, strict Clippy and formatting | Passed |
| Protocol check/build and strict Clippy | Passed; separate formatting check failed as described below |

The extended standalone Protocol formatting check found a line-wrap mismatch at `session-protocol/src/notification.rs:126`. That file is unchanged from `origin/main`; KVG-5291 tracks the separate cleanup. The protocol behavior checks pass. This is not a claim that every repository check is green.

Logs are `/tmp/KVG-5206-disabled-*.log`. Prior source-guard and reconnect red/green evidence remains in the task Handoff Notes. Earlier parallel Sidecar startup failures are tracked in KVG-5290; the current 27-case pass does not establish their cause or prove that rebasing fixed them. KVG-5245 separately tracks intermittent backend `openpty` failures. Earlier package resource-seal failures are historical; the rebuilt package above passed strict verification.

No terminal-renderer/conformance implementation changed in this checkpoint. Existing package source tests ran through the root suite, plugin artifacts were rebuilt during packaging, and SDK published-package contract checks passed. Full packaged update continuity, additional live/resource scenarios, representative update UX inspection and release acceptance remain pending. A disabled checkpoint must not be represented as completion of the full OpenSpec change.

Useful verification commands:

```sh
cargo test --locked --manifest-path src-tauri/crates/update-helper/Cargo.toml --all-features
cargo clippy --locked --manifest-path src-tauri/crates/update-helper/Cargo.toml --all-targets --all-features -- -D warnings
RUN_UPDATE_HELPER_CONTRACT=1 pnpm exec vitest run src/electron/updateInstallContract.test.ts
RUN_ELECTRON_PACKAGE_CONTRACT=1 pnpm exec vitest run scripts/electron-package.integrity.test.mjs scripts/electron-package.test.mjs
node scripts/electron-packaged-smoke.mjs --skip-package --app '/path/to/private/Open Forge.app'
```

## Remaining gates

The single fresh-context read-only completion review approved the disabled checkpoint with no correctness, security or structural blockers. It covered all 62 changed tracked paths and 18 untracked files against `8976dc86c`. Review run: `e5f0b4af-3a5c-4878-bed7-8ef02b9ff919`; report: `/tmp/KVG-5206-disabled-completion-review.md`. Strict OpenSpec validation and whitespace checks passed. This approval does not enable updates or complete the OpenSpec change; keep the update menu and source installer disabled.

Before enabling the local macOS arm64 update path:

1. Complete original source app/Sidecar birth and exit attestation, authenticated preparation-loss recovery, and Installed/no-launch forward recovery. Missing authority or runtime outcome must remain unknown.
2. Finish required crash-boundary and lost-acknowledgement coverage, including packaged backend-commit reconciliation and explicit same-transport retry faults.
3. Finish safe install/cancellation/recovery UX and representative visual checks.
4. Obtain KVG-4730 packaged agent/tool/shell PID/PTY, per-window restoration-before-commit and failure/recovery acceptance. Reconcile that task's broader architecture wording with the approved macOS arm64 update scope.
5. Validate and review the enabling change against its complete affected-system diff. Fixture success alone cannot enable updates.

Published releases additionally require KVG-1789 signing/notarization and protected publisher-key provisioning and backup. Those deferred publication gates do not block a locally approved integrity-sealed checkpoint. Legacy first adoption, source-installer integration and additional update platforms require separate implementation and acceptance; they remain disabled. No production private key was accessed for this work.
