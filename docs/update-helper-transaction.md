# Updater transaction implementation checkpoint

KVG-5206 is unfinished. Production updates and source installation remain disabled. The native helper and Electron handoff now execute against isolated installations, but the production updater is not wired end to end.

## Implemented boundaries

- Complete-app staging requires Electron, the Sidecar, session daemon, CLI payload and native updater helper. Packaging builds and copies `openforge-update-helper` and checks its Mach-O architecture alongside the other executables.
- Electron reloads authenticated authorization and remeasures staged bytes before copying the helper into private recovery storage. It hashes the copied bytes before executing them. Local-build approval does not authorize session interruption.
- The helper uses a fresh random challenge and a domain-separated HMAC over the exact request. Authority binds the installation, operation, destination, staging, recovery root and target manifest. Commands arrive through inherited pipes, not an unauthenticated socket or environment override.
- The helper independently checks the persisted grant and complete bundle. It authenticates before acquiring installation ownership. Kernel locks and permanent destination-to-recovery-root binding serialize owners. Durable operation tombstones reject replay.
- A macOS kernel process-exit watch identifies the spawning host before preparation. An authenticated install decision arms the operation, but closing stdin alone never permits replacement. The helper waits for that host to exit. It neither guesses PIDs nor kills sessions.
- EOF before install authority cancels preparation. Protocol frames and the post-arming host-exit wait have bounded deadlines. Unsupported platforms fail closed.
- The authenticated grant carries Electron user data, application data and daemon roots. The helper validates those directories and passes only those explicit OpenForge settings to the replacement. It does not inherit arbitrary `OPENFORGE_*` values or silently launch against default developer data. Grants without launch context cannot use the executable handoff.
- An authenticated, atomically written journal records preparation, replacement, launch fencing and commit. Replacement retains the old bundle and flushes files and directory changes. Pre-launch recovery verifies old bytes before restoring them. After launch, rollback is refused because target domain processes may have migrated data.
- Native commit rechecks authorization and installed bytes, is retryable after a lost acknowledgement, and allows a later operation without deleting retained bundles. The coordinator calls the update driver's commit only after runtime readiness and workspace restoration. It also cancels prepared helper ownership when preparation fails.
- The coordinator now requires a Sidecar-exit verifier before update preparation. After authenticated detach it waits for the exact spawned Sidecar's exit before calling the replacement driver. The Electron adapter records exit from spawn time and bounds shutdown using the existing shutdown budget. Signal acknowledgement, `killed`, and shutdown reports do not count as exit proof.
- `MaintenanceClient` borrows the current Sidecar controller for preflight without `Connect`, daemon launch or session mutation methods. Its read-only replacement observation also works after that controller becomes stale, without fencing the replacement Sidecar.
- A live-runtime handoff authenticates the source controller. The helper copies the target runtime into installation-owned immutable storage, verifies that its daemon and complete CLI payload match the authorized app, and keeps durable release pins. It records the source controller, daemon PID, source image, release digest and preparation intent before asking the daemon to prepare. A cold handoff instead holds launch and lifetime locks and refuses an existing owner.
- After host exit and bundle replacement, the helper activates the prepared daemon before launching the target app. Native commit requires a fresh Sidecar controller for the preserved lifetime, the original daemon PID, and an activated operation receipt whose actual image matches the prepared image. Unknown receipts are not evidence of successful cancellation. Target-app startup authentication remains unfinished.

The destination, staging and recovery directories must share a filesystem. Recovery storage, authorization and staging cannot be inside the installed bundle. Launch data cannot be inside either replaceable bundle.

First-adoption authorization now requires a separate native interruption confirmation after build trust succeeds. The authenticated grant binds both installed and target bundle hashes to the installation and operation. The helper accepts a pre-daemon source only with this explicit grant and unchanged installed bytes. Pre-launch rollback can restore that legacy source. This does not yet wire legacy process shutdown or the source-installer UI into an end-to-end first-adoption flow.

A daemon-aware source may lack the helper introduced by its target; that alone does not require interruption approval. The helper still requires a daemon-aware source's daemon and CLI, and every target must contain the complete app including its helper.

## Evidence and limits

The native suite covers tampering, operation replay, conflicting roots and owners, corrupt journals, rollback, post-launch refusal, commit, lost pipes and killed owners. Process tests reject unauthenticated and stale-challenge requests before acquiring installation ownership.

The opt-in Electron/native contract uses actual compiled helper and daemon bytes, real Electron authorization and an owned temporary host process. It covers cancellation, cold-install refusal over a live owner, incompatible daemon/CLI payloads, host exit, replacement, distinct-image daemon activation and fresh-controller commit. The daemon retains its PID and lifetime. Electron and Sidecar are still stand-ins, and this contract does not create PTYs. A separate Rust test activates a distinct image through `MaintenanceClient` while preserving a real `/bin/cat` PID, PTY and input/output. Neither test establishes packaged Electron/Sidecar/daemon continuity or KVG-4730 acceptance.

Latest runtime-integration checks:

- Opt-in native contract: 12 passed. An initial fixture wait expired while the journal still reported `replacing`. The test now observes release of native transaction ownership before checking target startup or deleting its root. State probes remain bounded at five seconds; transaction completion has a separate deadline.
- Client default/all-feature suites: 18 passed each. Helper suites: 18 passed each. Both crates passed all-target/all-feature check, build, strict Clippy and formatting.
- Daemon default suite: 93 passed, 2 ignored. All-target/all-feature check, build, strict Clippy and formatting passed. Two focused updater tests passed, including live PTY continuity and read-only replacement observation.
- Daemon all-feature runs failed in `tests/agent_gateway.rs:22` during `Client::launch`, with `daemon startup timed out; retry attachment without launching a host`. A separate retry also failed. Related parallel-startup work already exists as KVG-5188; no duplicate task or unrelated timeout change was made.
- TypeScript, plugin-host typecheck, lint and Electron/Companion contracts passed.
- The first full root attempt exceeded its 300-second tool limit with browser-test timeouts. The next completed in 377.85 seconds with 876 files and 7,475 tests passed, one failure, 3 expected failures and 55 skips. The failure is the unchanged five-second limit in `scripts/check-ui-migration-inventory.test.mjs:202`. Its isolated rerun passed all 27 tests in 2.24 seconds. This is not a green full-task run.
- Logs use `/tmp/KVG-5206-runtime-*.log`. Unrelated worktrees were running Vite and Vitest during these attempts; none of those processes were stopped. Broader package, Sidecar and packaged acceptance evidence below predates this increment.

Earlier successful checkpoints:

- Last full root run: 877 files passed, 7,476 tests passed, 3 expected failures, 49 skipped across 12 files. The opt-in native contract subsequently passed 7 tests, including the added daemon-aware source without an old helper.
- Helper default and all-feature suites: 18 tests each. All-target/all-feature check, build and strict Clippy passed, along with formatting.
- TypeScript, plugin-host typecheck, lint, Electron and Companion contracts passed.
- `pnpm electron:package` passed, including plugin builds, renderer/Electron builds, release Sidecar/daemon/helper compilation, architecture checks and app assembly. The bundle was built, not installed or launched.
- Workspace package builds/tests, plugin SDK published-package conformance, package metadata checks and plugin-host typecheck passed. Terminal-runtime tests include one skip.
- Sidecar tests: 2,369 passed and 49 ignored. Sidecar check, build and Clippy passed.
- Daemon default tests and all-target/all-feature check, build and strict Clippy passed. Earlier all-feature daemon evidence remains applicable; ignored tests are not acceptance evidence.
- The earlier standalone host/client blockers were fixed with owner approval. Their default/all-feature tests, check/build, strict Clippy and formatting passed. KVG-5209 and KVG-5210 were deleted at the owner's request.

Logs for the helper checkpoint are under `/tmp/KVG-5206-next-*.log`; the owned-exit increment uses `/tmp/KVG-5206-exit-*.log`. The first root test run exceeded its two-minute tool deadline; the rerun passed in 146 seconds. Isolated Node child tests establish exit ordering, not real Sidecar/daemon continuity.

First-adoption red/green and validation logs use `/tmp/KVG-5206-adoption-*.log`. Native contract cases cover approved legacy replacement/recovery, missing interruption consent and changed installed bytes. Authorization tests cover separate cancellation, source mutation during consent and refusing failed publisher trust without any approval prompt. Native dialog response tests use the external Electron dialog boundary; no real legacy processes were interrupted. The first Rust check wrapper mis-split arguments and was discarded; explicit commands then passed both default/all-feature suites and all-target/all-feature static checks.

Run the native contract and checks through the layout resolver:

```sh
MANIFEST="$(node scripts/rust-sidecar-layout.mjs update-helper-manifest-path)"
cargo test --manifest-path "$MANIFEST" --all-features
cargo check --manifest-path "$MANIFEST" --all-features --all-targets
cargo build --manifest-path "$MANIFEST" --all-features --all-targets
cargo clippy --manifest-path "$MANIFEST" --all-features --all-targets -- -D warnings
cargo fmt --manifest-path "$MANIFEST" -- --check
RUN_UPDATE_HELPER_CONTRACT=1 pnpm exec vitest run src/electron/updateInstallContract.test.ts
```

Strip inherited `OPENFORGE_*` settings before validation. Tests use private copies and owned temporary roots, never the developer installation or runtime. A fresh private executable gets a ten-second first probe, warmed fixture probes use two seconds, and state probes use five seconds. Keep tests parallel and clean up only their owned fixtures.

## Remaining KVG-5206 work

- Connect the real update driver and source installer to the coordinator's verified Sidecar-exit boundary. Production launch and source-install guards remain unchanged; a working helper and exit verifier do not supply this missing end-to-end integration.
- Connect the implemented daemon preflight, activation, immutable runtime/CLI retention and fresh-controller commit to the real update driver. Authenticate target-app startup before any Sidecar or database access, then reconcile sessions and restore windows before commit. Add complete agent/tool/shell PID and PTY evidence.
- Wire the separate native first-adoption consent into verified legacy shutdown and the source installer. Consent and authorized legacy transaction support exist, but no end-to-end first-adoption flow or seamless migration claim is made.
- Exercise every replacement/rollback durability boundary, failed relaunch and actual packaged continuity. Current process-loss tests do not cover every rename or power-loss boundary.
- Integrate protected publisher signing and arrange credential provisioning and encrypted backup with the owner. No production private key was read, printed, committed or uploaded for this work.
- Finish affected-system validation, including applicable package-local builds/conformance and isolated packaged smoke/live checks, then publish completed implementation evidence. No complete-feature validation or acceptance claim is made here.
- The owner approved isolated Playwright Chromium for required conformance tests. Terminal-runtime conformance passed 35 semantic checks, 13 visual baselines and the native terminal colour-profile test. Report: `artifacts/terminal-presentation/report.json`. This clears the browser-conformance approval blocker, not packaged updater continuity or production enablement.

## Activation gates

1. Finish the remaining implementation and focused evidence. OpenSpec remains 15/54 checked; task 8.2 is partial.
2. Complete affected-system validation. Passing helper and fixture tests does not clear the packaged continuity gate.
3. KVG-4730 supplies comprehensive packaged acceptance and release evidence. The approved implementation target is macOS arm64; reconcile that task's x64 wording before acceptance claims. Do not create a duplicate acceptance task.
4. KVG-1789 satisfies macOS signing/notarization prerequisites. Publisher signing must run in owner-approved protected infrastructure with the pinned public key and encrypted private-key backup.
5. Only after these gates pass may a reviewed change enable production updates.
