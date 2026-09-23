# Packaged Session Daemon releases

Packaged macOS builds contain `Contents/MacOS/session-runtime/manifest.json`, the daemon, and the packaged CLI runtime files. Packaging checks Electron, Sidecar, and daemon architectures for both explicit Rust targets and native builds. The manifest declares artifact hashes, architecture, protocol, and checkpoint format.

The release Sidecar selects this packaged runtime. The Session Client first attempts authenticated reattachment. If a daemon must be launched, it copies the manifest's files into the installation's `session-v1/releases/<manifest-sha256>/` directory and launches that copy. Reattachment does not require the old app bundle to remain present. Development builds continue to use their separately built daemon.

## Integrity and trust

Staging validates hashes and compatibility before publishing a directory by atomic rename. Files are owner-readable and non-writable, with execute permission only on executable artifacts. Directories are private. Existing versions are verified, not overwritten. Symlinks, foreign installation markers, unowned directories, malformed paths, and altered files are refused.

This is artifact integrity verification, **not publisher authentication**. Initial launch uses the payload of the app the user installed. `ReleaseStore::preflight` checks installation identity and both staged target and fallback artifacts, then refuses replacement because production release trust verification is unavailable. It does not execute the target, pause a daemon, or acquire a controller generation. There is no environment-variable trust bypass. The existing production live-replacement gate remains closed. Release signing work is tracked separately in KVG-1789.

No release feed, download, discovery, updater UI, or automatic app rollback is introduced. Manifest compatibility is not proof that an arbitrary new executable can restore a live checkpoint. Production activation still requires publisher verification and the daemon's isolated image/state probe before destructive exec.

## Capacity and replacement at scale

A fresh Session Daemon allows up to 896 live PTYs within 1,024 retained records; it keeps at most 128 settled exits. These are structural limits, not a promise that 896 PTYs will fit on every machine. Before spawn, the daemon checks file descriptors, process slots, and memory headroom. A refusal names the limiting resource and leaves existing PTYs alone. `inventory.capacity.resources` reports the sampled counts, reserve, and checkpoint byte limit. Do not raise `liveLimit` alone: the host ledger, inherited descriptors, and checkpoint must all fit.

In the macOS arm64 replacement fixture, 33 live PTYs produced a 234,856-byte checkpoint and 37 inherited FDs with a 385 ms pause. At 256 PTYs, the checkpoint was 1,793,059 bytes with 260 inherited FDs and a 2,133 ms pause. The backend allows four seconds for coordinated checkpoint capture. It refuses an over-budget or timed-out checkpoint before exec, reopens paused readers, and keeps the old daemon serving. Fixture tests also write to PTYs after refusal. These measurements are not a production update benchmark.

If admission fails, inspect the resource in the typed `capacityExceeded` error and compare it with `inventory.capacity.resources`. The host retires settled entries automatically when history fills; ending live sessions releases descriptors and process slots. Do not kill the daemon to work around a limit while it owns PTYs. If a replacement fails at `checkpoint`, keep using the old daemon and investigate checkpoint size, pause time, and available memory before retrying. Production trusted activation remains closed pending KVG-5206 and publisher verification in KVG-1789. Recheck packaged-update compatibility with the shipped updater when that work lands.

Compatibility is deliberately narrow while the production update gate is closed:

| Direction | Current status |
| --- | --- |
| Fresh launch with this daemon | Uses the resource checks and limits above. |
| Validated 32-live-session ledger into this daemon | Unit tests preserve the PTY identity and operation receipts while expanding limits. An installed legacy binary has not been exercised. |
| This daemon into a 32-session image | Unsupported. The future updater must reject the downgrade before exec; do not use a fixture success as evidence otherwise. |
| Unknown checkpoint format or altered descriptors | Rejected by image validation. No compatibility promise for older formats. |
| Packaged production update | Disabled until KVG-5206 supplies trusted activation and KVG-1789 supplies publisher verification. |

The operation window exposes retained receipt counts and limits separately from PTY capacity. A client may retire observed receipts; a refusal does not authorize replaying an uncertain mutation. A blocked replacement reports its failed stage and keeps the old image serving if it has not crossed exec.

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

A successful termination reply can precede the bounded PTY output drain. Fixture cleanup retries only an explicit `shutdownEmpty` / `invalidRequest` refusal for up to five seconds, retaining the same controller and never replaying termination. Unknown outcomes, transport failures, stale ownership, and deadline expiry retain resources and fail. Protocol diagnostics expose only the command and an allowlisted error category, not daemon error payloads or credentials.

## Verification

Focused checks:

```sh
pnpm exec vitest run scripts/electron-package.test.mjs scripts/electron-package/runtime-release.test.mjs scripts/desktop-test/daemon-ownership.test.mjs
cargo test --manifest-path src-tauri/crates/session-client/Cargo.toml --test releases
cargo test --manifest-path src-tauri/crates/session-daemon/Cargo.toml --test packaged_release
```

The daemon integration test uses the actual packaging manifest writer by default. Set `OPENFORGE_PACKAGED_RUNTIME` to an existing `.app/Contents/MacOS/session-runtime` to test the payload copied from that app instead; CI uses this path. The test launches a staged daemon with a live shell, deletes its temporary source bundle, verifies stable daemon lifetime and shell PID/PTY identity after refusal, sends further input, and exercises authenticated registry cleanup. Store tests cover corrupt and incompatible manifests, symlinks, executable permissions, foreign ownership, leases, durable references, and unknown artifacts.

KVG-4728 has native macOS arm64 package and packaged-smoke evidence locally, plus native Intel x64 evidence from [CI run 35535077246](https://github.com/koenvg/openforge/actions/runs/35535077246), job `Packaged Session Runtime (x64)`. That job passed packaging, staged launch/bundle-removal/refusal/cleanup, and packaged Electron smoke on an Intel Core i7-8700B with translation disabled. The `packaged-session-runtime-x64` artifact records the architecture, manifest, daemon SHA-256 (`7c16ab7096c7a3a360b01f856a76e43c9824bb8a49eee2cba1d497dc0472ce25`), and test logs. Production trusted replacement remains deliberately disabled.

`.github/workflows/packaged-session-runtime.yml` runs independently of the broad CI gate, requires native host/Node architectures, rejects Rosetta, and uploads evidence even on failure. Its arm64 job uses `macos-15`; Intel uses `macos-15-intel`. The first arm64 attempt on macOS 15 failed in Whisper/ggml compilation before daemon validation because `vmmlaq_s32` requires `i8mm`. That run remains historical evidence; the portable CPU policy now prevents the unsupported instruction from blocking this workflow.

Validation scope was the scripts, Electron desktop shell, Rust Sidecar, and session host/protocol/client/daemon crates. The unchanged renderer and workspace packages were not rerun as a repository-wide test suite.

- Initial implementation checks passed: 657 scripts tests, 349 Electron tests, root and Electron TypeScript checks, lint, desktop IPC registry checks, workspace metadata, affected Rust test/check/build/clippy/format, native arm64 packaging, optimized launch/refusal, and isolated smoke.
- Follow-up checks passed: the delayed/fragmented mock HTTP regression, all 13 gateway tests, the full post-merge Session Daemon contract command, 448 tests selected by `vitest run electron`, workflow tests and `actionlint`, Electron TypeScript, IPC, metadata, lint, and daemon clippy/format.
- The accepted sockets explicitly use blocking reads; the response fixture collects complete headers rather than assuming one read contains them. The gateway suite passed in all three concurrent full contract copies. Two complete copies passed; the third timed out waiting for provider CLI receipts in separate Sidecar fixtures, tracked by KVG-5151. No suite serialization was added.
- Earlier follow-up full scripts runs exceeded unchanged inventory/Storybook five-second deadlines (KVG-5153). The latest full scripts run passes all 668 tests, including delayed-drain cleanup, deadline expiry, unknown/stale refusals, and credential-safe protocol diagnostics. Earlier failed runs remain recorded rather than counted as passes.
- Existing ignored tests remain ignored except the cross-boundary fixtures explicitly selected by the contract command. Trusted live replacement and the separate updater/source-install transaction were not validated. Native x64 launch evidence is now present; the updated arm64 CI lane still needs a passing run.
