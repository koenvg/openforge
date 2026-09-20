# Packaged Session Daemon releases

Packaged macOS builds contain `Contents/MacOS/session-runtime/manifest.json`, the daemon, and the packaged CLI runtime files. Packaging checks Electron, Sidecar, and daemon architectures for both explicit Rust targets and native builds. The manifest declares artifact hashes, architecture, protocol, and checkpoint format.

The release Sidecar selects this packaged runtime. The Session Client first attempts authenticated reattachment. If a daemon must be launched, it copies the manifest's files into the installation's `session-v1/releases/<manifest-sha256>/` directory and launches that copy. Reattachment does not require the old app bundle to remain present. Development builds continue to use their separately built daemon.

## Integrity and trust

Staging validates hashes and compatibility before publishing a directory by atomic rename. Files are owner-readable and non-writable, with execute permission only on executable artifacts. Directories are private. Existing versions are verified, not overwritten. Symlinks, foreign installation markers, unowned directories, malformed paths, and altered files are refused.

This is artifact integrity verification, **not publisher authentication**. Initial launch uses the payload of the app the user installed. `ReleaseStore::preflight` checks installation identity and both staged target and fallback artifacts, then refuses replacement because production release trust verification is unavailable. It does not execute the target, pause a daemon, or acquire a controller generation. There is no environment-variable trust bypass. The existing production live-replacement gate remains closed. Release signing work is tracked separately in KVG-1789.

No release feed, download, discovery, updater UI, or automatic app rollback is introduced. Manifest compatibility is not proof that an arbitrary new executable can restore a live checkpoint. Production activation still requires publisher verification and the daemon's isolated image/state probe before destructive exec.

## Retention and cleanup

- A staged handle holds a shared lease until its caller finishes using it.
- Launch writes a durable `session-<release-id>` reference before spawning. A failed or interrupted launch does not discard that reference.
- `retain` also supports caller-owned checkpoint and operation references. References cannot silently switch to different releases.
- Cleanup acquires installation ownership. While a daemon is alive, it conservatively retains all releases, including assets needed by sessions or recovery.
- After daemon exit, cleanup removes only verified, unreferenced, unleased releases. Unknown or corrupt entries stop cleanup before deletion.
- `release_reference` is an explicit completion operation and refuses to run while a daemon owns the installation. There is no age-based eviction or automatic removal of unresolved launch references.

The caller coordinating a future update must retain its target and fallback until its checkpoint and operation are complete. Dropping a process or a staged handle is not operation completion. References and files cannot recover PTYs after fatal loss of their sole owning process.

Provider-generated hook configuration already lives outside the app bundle, and the Claude/Grok hook transport is embedded in generated commands. This change does not migrate provider configuration or change provider discovery paths. Atomic installation of those shared hook files is tracked in KVG-5149.

## Fixture ownership

The packaged smoke test registers its newly allocated private runtime root before launching Electron. Cleanup uses that root's credentials and Session Protocol to terminate fixture PTYs, including daemon-supervised descendants, then shut down the empty detached daemon. It checks the installation's ownership descriptor for remaining holders before deleting fixture directories. Failed or uncertain cleanup retains resources and fails the test. Reuse registries never read borrowed credentials or terminate borrowed processes.

## Verification

Focused checks:

```sh
pnpm exec vitest run scripts/electron-package.test.mjs scripts/electron-package/runtime-release.test.mjs scripts/desktop-test/daemon-ownership.test.mjs
cargo test --manifest-path src-tauri/crates/session-client/Cargo.toml --test releases
cargo test --manifest-path src-tauri/crates/session-daemon/Cargo.toml --test packaged_release
```

The daemon integration test uses the actual packaging manifest writer, launches a staged daemon with a live shell, deletes the source bundle, verifies stable daemon lifetime and shell PID/PTY identity after refusal, sends further input, and exercises authenticated registry cleanup. Store tests cover corrupt and incompatible manifests, symlinks, executable permissions, foreign ownership, leases, durable references, and unknown artifacts.

KVG-4728 has native macOS arm64 package and packaged-smoke evidence. The architecture/manifest contract tests cover x64, but no native x64 package launch or live replacement evidence has been collected. Production trusted replacement is deliberately not enabled.

Validation scope was the scripts, Electron desktop shell, Rust Sidecar, and session host/protocol/client/daemon crates. The unchanged renderer and workspace packages were not rerun as a repository-wide test suite.

- Passed: 657 scripts tests, 349 Electron tests, root and Electron TypeScript checks, lint, desktop IPC registry checks, and workspace metadata checks.
- Passed: Rust test/check/build/clippy and formatting for the affected crates, native desktop packaging, optimized packaged launch/refusal, and isolated packaged smoke.
- The full Session Daemon contract command passed earlier, but its final two runs failed in existing `agent_gateway.rs` fixtures with macOS `WouldBlock` errors at the mock Sidecar reads. The diagnostics case passed in a targeted rerun; the subsequent full rerun failed in the notification fixture tracked by KVG-5139. This final contract gate is not green.
- Existing ignored tests remain ignored except the cross-boundary fixtures explicitly selected by the contract command. Native x64 execution, trusted live replacement, and the separate updater/source-install transaction were not validated.
- Final process inspection found no remaining daemon processes from this worktree or the packaged fixture roots.
