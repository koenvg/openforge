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

The destination, staging and recovery directories must share a filesystem. Recovery storage, authorization and staging cannot be inside the installed bundle. Launch data cannot be inside either replaceable bundle. Current replacement requires a complete daemon-aware old bundle; the pre-daemon first-adoption path is not implemented.

## Evidence and limits

The native suite covers tampering, operation replay, conflicting roots and owners, corrupt journals, rollback, post-launch refusal, commit, lost pipes and killed owners. Process tests reject unauthenticated and stale-challenge requests before acquiring installation ownership.

The opt-in Electron/native contract uses actual compiled helper bytes, real Electron authorization and an owned temporary host process. It verifies cancellation, waits for host exit, installs the target, launches a short-lived fixture app with the authorized data roots, and commits through another helper process. Other application components remain fixtures. This is not evidence of Electron/Sidecar/daemon/PID/PTY continuity or KVG-4730 packaged acceptance.

Latest checks:

- Root tests: 876 files passed, 7,467 tests passed, 3 expected failures, 46 skipped across 12 files. The opt-in native contract passed separately, 3 tests.
- Helper default and all-feature suites: 18 tests each. All-target/all-feature check, build and strict Clippy passed, along with formatting.
- TypeScript, plugin-host typecheck, lint, Electron and Companion contracts passed.
- Sidecar tests: 2,369 passed and 49 ignored. Sidecar check, build and Clippy passed.
- Daemon default tests and all-target/all-feature check, build and strict Clippy passed. Earlier all-feature daemon evidence remains applicable; ignored tests are not acceptance evidence.
- The earlier standalone host/client blockers were fixed with owner approval. Their default/all-feature tests, check/build, strict Clippy and formatting passed. KVG-5209 and KVG-5210 were deleted at the owner's request.

Logs for this increment are under `/tmp/KVG-5206-next-*.log`, with red/green checkpoints under `/tmp/KVG-5206-*.log`.

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

- Connect the real update driver, coordinator and source installer. The host must verify its owned Sidecar has exited after authenticated detach before arming the helper. Observing Electron exit alone does not prove domain shutdown. Production launch and source-install guards remain unchanged; driver callbacks and a working helper do not supply this missing integration.
- Preflight and activate the compatible daemon image, retain runtime and CLI assets, and authenticate running executable identities and reconciliation before commit. Preserve agent/tool/shell PIDs and PTYs through the supported transition.
- Add separate native first-adoption interruption approval. Do not reinterpret local-build approval as interruption consent or claim seamless adoption from a pre-daemon build.
- Exercise every replacement/rollback durability boundary, failed relaunch and actual packaged continuity. Current process-loss tests do not cover every rename or power-loss boundary.
- Integrate protected publisher signing and arrange credential provisioning and encrypted backup with the owner. No production private key was read, printed, committed or uploaded for this work.
- Finish affected-system validation, including applicable package-local builds/conformance and isolated packaged smoke/live checks, then publish completed implementation evidence. No complete-feature validation or acceptance claim is made here.

## Activation gates

1. Finish the remaining implementation and focused evidence. OpenSpec remains 15/54 checked; task 8.2 is partial.
2. Complete affected-system validation. Passing helper and fixture tests does not clear the packaged continuity gate.
3. KVG-4730 supplies comprehensive packaged acceptance and release evidence. The approved implementation target is macOS arm64; reconcile that task's x64 wording before acceptance claims. Do not create a duplicate acceptance task.
4. KVG-1789 satisfies macOS signing/notarization prerequisites. Publisher signing must run in owner-approved protected infrastructure with the pinned public key and encrypted private-key backup.
5. Only after these gates pass may a reviewed change enable production updates.
