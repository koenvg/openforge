# Updater transaction implementation checkpoint

KVG-5206 is unfinished. Production updates and source installation remain disabled. This checkpoint implements an internal replacement library and isolated tests, not a working production updater.

## Implemented boundaries

- Complete-app staging requires Electron, the Sidecar, session daemon, CLI payload and native updater helper. The target identity includes the helper; update readiness rejects an old helper identity.
- Electron install preflight reloads the authenticated authorization and measures staged bytes again. It does not infer authority from a caller-provided manifest or treat local-build approval as permission to interrupt sessions.
- `src-tauri/crates/update-helper` independently reads Electron's HMAC authorization format, checks installation/operation/destination/staging identity, and measures the complete bundle using the same manifest encoding.
- Kernel file locks serialize live owners. A permanent destination ownership record binds the installation to its recovery directory, preventing a second state directory from bypassing pending recovery. No PID guessing, process-name kills or stale-lock deletion is used.
- An authenticated, atomically written journal records preparation, replacement and launch fencing. Operation tombstones reject replay. Reopening the library after process exit reauthenticates the journal.
- Replacement keeps the old bundle outside the installed app and flushes bundle files and journal/directory changes. Recovery verifies the retained bundle before restoring it. It retains displaced target bytes rather than deleting an unknown installation.
- The launch fence is persisted before any future target app/domain launch. After that fence, automatic app rollback is refused because the target may have migrated the database. This library does not launch the target or decide session recovery.

The destination, staging and recovery directories must be on the same filesystem. Unsupported layouts fail before replacement. Recovery storage, staging and authorization cannot be inside the installed bundle; recovery storage cannot be inside the staged target.

## Evidence and limits

The Rust suite exercises tampered target bytes and authorization, corrupt recovery records, conflicting owners, state-root substitution, operation replay, rollback and post-launch rollback refusal. An owned subprocess is killed after installing a temporary bundle, then a new owner restores the old bundle. These tests do not contact the desktop runtime.

The opt-in Electron/native contract test uses the real Electron authorization writer and real native fixture executable bytes, replaces an isolated temporary bundle, and recovers through another process. Its other app components are fixtures, not a packaged running Electron/Sidecar/daemon transition. It is not KVG-4730 acceptance evidence for session continuity.

Run the native library checks through the layout resolver:

```sh
MANIFEST="$(node scripts/rust-sidecar-layout.mjs update-helper-manifest-path)"
cargo test --manifest-path "$MANIFEST" --all-features
cargo check --manifest-path "$MANIFEST" --all-features --all-targets
cargo build --manifest-path "$MANIFEST" --all-features --all-targets
cargo clippy --manifest-path "$MANIFEST" --all-features --all-targets -- -D warnings
cargo fmt --manifest-path "$MANIFEST" -- --check
RUN_UPDATE_HELPER_CONTRACT=1 pnpm exec vitest run src/electron/updateInstallContract.test.ts
```

Strip inherited `OPENFORGE_*` settings before invoking validation. The contract test clears the helper subprocess environment. Only a newly copied private executable gets a ten-second first probe; subsequent invocations use two seconds. The killed-process fixture uses the five-second state deadline and owns cleanup.

## Remaining KVG-5206 work

- Package the production helper and authenticate the live host-to-helper handoff. The existing example executable is feature-gated test tooling only, never an installer entry point.
- Connect coordinator and source installer without removing existing production guards or providing a test/environment bypass.
- Integrate compatible daemon activation, retained runtime/CLI assets, authenticated readiness and interface restoration before commit.
- Add separate first-adoption interruption approval. Local-build approval alone remains insufficient.
- Exercise interruption at every replacement/rollback durability boundary, failed relaunch and actual packaged executable/PID/PTY continuity. Current process-loss evidence covers an installed, pre-launch transaction, not every power-loss or rename boundary.
- Integrate protected publisher signing and arrange credential provisioning and secure private-key backup with the owner. Do not read, print, commit or upload the production private key as part of tests.
- Finish full affected-system validation and publish the completed implementation evidence.

## Activation gates

1. Finish the implementation and focused evidence above, including authenticated helper launch and compatible live daemon activation.
2. Complete affected-system validation. The standalone host/client validation failures were fixed within KVG-5206 with owner approval, and KVG-5209/KVG-5210 were deleted at the owner's request. Host and client default/all-feature tests, all-target checks/builds, strict Clippy and formatting now pass. The signed fixtures use protocol 4 and retain explicit refusal of correctly signed protocol-3 releases; production compatibility and publisher trust are unchanged. Broader validation and packaged evidence remain outstanding.
3. KVG-4730 must supply comprehensive isolated packaged acceptance and release evidence. Keep its repeated-update, failure and platform checks there. The current OpenSpec implementation target is macOS arm64; its task prompt still mentions x64, which needs owner reconciliation before acceptance claims.
4. KVG-1789 must satisfy macOS signing/notarization prerequisites. Publisher signing must also run in owner-approved protected infrastructure, with the pinned key and secure backup in place.
5. Only after those gates pass may a reviewed change enable production updates. No gate is cleared by this checkpoint.
