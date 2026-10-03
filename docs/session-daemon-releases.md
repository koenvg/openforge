# Packaged Session Daemon releases

Packaged macOS builds contain `Contents/Resources/session-runtime/manifest.json`, the retained daemon, and the packaged CLI runtime files. Packaging checks Electron, Sidecar, daemon and updater-helper architectures for both explicit Rust targets and native builds. The manifest declares artifact hashes, architecture, protocol and checkpoint format. The plugin host lives under `Contents/Resources/plugin-host`. Local ad-hoc code sealing preserves retained daemon bytes and supplies integrity, not publisher authentication.

The release Sidecar selects this packaged runtime. The Session Client first attempts authenticated reattachment. If a daemon must be launched, it copies the manifest's files into the installation's `session-v1/releases/<manifest-sha256>/` directory and launches that copy. Reattachment does not require the old app bundle to remain present. Development builds continue to use their separately built daemon.

## Integrity and trust

Staging validates hashes and compatibility before publishing a directory by atomic rename. Files are owner-readable and non-writable, with execute permission only on executable artifacts. Directories are private. Existing versions are verified, not overwritten. Symlinks, foreign installation markers, unowned directories, malformed paths, and altered files are refused.

This is artifact integrity verification, **not publisher authentication**. Initial launch uses the payload of the app the user installed. `ReleaseStore::preflight` checks installation identity and both staged target and fallback artifacts, then refuses replacement because production release trust verification is unavailable. It does not execute the target, pause a daemon, or acquire a controller generation. There is no environment-variable trust bypass. The existing production live-replacement gate remains closed. Release signing work is tracked separately in KVG-1789.

No release feed, download, discovery or automatic app rollback is introduced. Manifest compatibility is not proof that an arbitrary new executable can restore a live checkpoint. Published activation requires publisher verification; a locally built target instead requires explicit complete-app approval bound to its immutable bytes and operation. Both require the daemon's isolated image/state probe before destructive exec. Update entry points remain disabled pending [the recovery and packaged acceptance gates](update-helper-transaction.md).

## Capacity and replacement at scale

A fresh daemon admits at most 896 live PTYs within 1,024 retained session records and keeps the newest 128 settled exits. These are structural bounds, not a machine capacity guarantee. The isolated workload validates 256 concurrent agent and indexed-shell PTYs, not a new hard cap. Live and draining processes are never discarded to fit history.

Before spawn, the daemon samples its open descriptors, the current user's process count, `RLIMIT_NOFILE`, `RLIMIT_NPROC`, and reclaimable system memory. For `N` live or draining PTYs after admission, it requires:

- Open descriptors plus `3 * N + 64` to fit the descriptor limit. This reserves restore wrappers and control descriptors.
- Occupied process slots plus one new process and 64 spare slots to fit the process limit.
- At least `64 MiB + 2 MiB * N` of reclaimable memory. This is admission headroom, not a measured per-PTY footprint or a bound on later output growth.

Checkpoint preflight checks the same envelope against the existing live/draining set before pausing it. Admission cannot guarantee that future terminal output will still fit a checkpoint.

### Diagnostics and refusals

`inventory.capacity` separates `liveSessions` / `liveLimit`, `retainedSessions` / `sessionLimit`, `operationReceipts` / `operationLimit`, `cleanupReceipts` / `cleanupLimit`, and `retainedRequestBytes` / `requestByteLimit`. Its optional `resources` object contains:

| Wire field | Meaning |
| --- | --- |
| `openDescriptors`, `descriptorLimit` | Sampled daemon descriptors and soft OS limit. |
| `occupiedProcesses`, `processLimit` | Sampled process count for the current user and soft OS limit. |
| `availableMemoryBytes`, `spawnMemoryReserveBytes` | Reclaimable memory estimate and reserve for the next PTY. |
| `checkpointByteLimit` | Backend retained-state budget, normally 33,554,432 bytes. Not the combined encoded-file budget. |

A failed resource sample can omit `resources`; omission is not proof of spare capacity. Diagnostics contain counts and bounds, not terminal contents, environments, credentials, or recovery payloads.

Typed errors use `{"capacityExceeded":"fileDescriptors"}` and the corresponding `processSlots`, `memoryHeadroom`, `ptyDevices`, `checkpointBytes`, or `checkpointTime` value. Host-side pressure can instead name `sessions`, `retainedHistory`, `operationReceipts`, or `requestBytes`. Some older/error paths return generic `capacity`. Do not classify every capacity error as receipt pressure.

A replacement refusal records a failed stage such as `preflight` or `checkpoint`. Before exec, dropping the pause guards reopens the original readers and ingress. Keep using the old daemon; do not kill it or start a second owner to bypass a refusal. A lost reply is not an abort receipt. Reconcile the replacement status and actual running image before retrying or rolling back.

### Checkpoint envelope and measured evidence

| Budget | Current bound |
| --- | --- |
| Backend retained terminal state | 32 MiB across live models and final recovery state. |
| Shared host ledger | 16 MiB, with saved limits and identity/receipt validation. |
| Encoded replacement body | 64 MiB, independently bounded during serialization. |
| Encoded header | 8 KiB, including descriptor inventory and notification checkpoint metadata. |
| Inherited descriptors | At most 1,024 PTY masters plus four root/checkpoint descriptors; all must be unique and validated. |
| Complete pre-exec pause | One ten-second deadline from ingress admission closure through the final pre-exec check. |

These are separate ceilings, not additive allocations or a promise that every maximally sized component fits simultaneously. Dense output, notification state, serialization overhead, or restore headroom can refuse a handoff even when the PTY count fits. Fixture-only byte/time overrides lower budgets to exercise refusal; they do not configure production capacity.

Ingress and reader quiescence, model capture, credential-file verification, ledger serialization, combined encoding, both image/state probes, checkpoint file synchronization, and the commit reply share this deadline. The final check refuses before destructive exec if the budget has expired.

Slow owned-snapshot work runs without the pause guards. Expiration drops those guards and resumes old I/O without waiting for encoding or filesystem work to finish. Further replacement preparation refuses while abandoned work is still alive. State-probe helpers use the remaining budget and are killed and reaped on refusal.

This is a pre-exec deadline, subject to OS scheduling and syscall latency, not a post-exec restoration bound or permission to enable production updates.

KVG-5263 reran the isolated fixture on native macOS arm64 against baseline `3a78e2309`:

| Live PTYs | Encoded checkpoint bytes | Inherited FDs | Observed pause |
| --- | --- | --- | --- |
| 33 | 240,009 | 37 | 380 ms |
| 256 | 1,829,216 | 260 | 2,163 ms |

At 256, this run sampled 1,295 open descriptors out of 1,048,576 and 786 process slots out of 5,333. Reclaimable memory was 9,776,906,240 bytes versus a 606,076,928-byte next-spawn reserve. These are fixture measurements on one provisioned host, not minimum OS settings, production update benchmarks, or native x64 replacement evidence. KVG-5236's earlier 256-PTY checkpoint was 1,793,059 bytes with a 2,133 ms pause; variation does not establish a worst-case bound. The tests check unchanged daemon/shell PID and PTY identity, ordered output and usable input/recovery after success, and usable old PTYs after forced byte/time refusal.

### Upgrade and downgrade support

The current Session Protocol is version 6 and the daemon replacement envelope is format 1. Shared-host ledger formats 1 and 2 are distinct from that envelope; format 2 carries the ordered operation window. Accepting a ledger format alone does not establish compatibility of an old daemon executable. The image probe checks protocol, envelope format, architecture, authority codec and state digest, then validates the complete checkpoint in both target and fallback images before destructive exec.

| Transition | Support and evidence |
| --- | --- |
| Fresh launch with the current packaged daemon on native macOS arm64 or x64 | Supported ordinary launch/reattachment with the admission policy above. Packaged launch/refusal evidence does not prove live update support. |
| Current compatible image to another current compatible image on macOS arm64 | Real exec continuity is tested only with `replacement-fixtures`. Ordinary production builds do not advertise live replacement. |
| Validated legacy 32-session ledger restored by current host code | The host test restores a ledger with a 32-session limit and one mocked session, asserts expansion to 896 live / 1,024 retained sessions, retains the PTY identity and receipt count across a checkpoint round trip, and rejects limit contraction. It does not test post-restore spawning or admission beyond 32. This is not an old-binary/updater handoff. |
| Actual legacy 32-session daemon to the current daemon | Not demonstrated or production-supported. No validated legacy image is available for this task, and trusted live activation remains disabled. OpenSpec task 3.4 stays pending. |
| Expanded daemon to a 32-session image | Unsupported. A compatible target and fallback must validate the actual enlarged checkpoint before exec. There is no demonstrated actual-legacy downgrade refusal through the trusted updater; do not infer it from unit tests or a generic incompatible-probe fixture. |
| Incompatible protocol, unknown replacement envelope, or corrupt/duplicate descriptors | Current validators reject these inputs before destructive daemon exec. Fixtures demonstrate incompatible probes and duplicate/invalid FD rejection, not actual legacy-format/updater acceptance. No arbitrary old-format migration is promised. |
| Complete packaged app update | Not supported yet. KVG-5206 landed a disabled checkpoint; KVG-5296 through KVG-5299, KVG-4730 packaged acceptance and KVG-5300 activation remain gates. Published updates also require KVG-1789 publisher verification. |

If an existing daemon lacks the supported replacement protocol, leave it serving its PTYs and report `unsupportedReplacement` or the protocol incompatibility. App configuration cannot change its persisted 32-session admission limits. Do not rewrite its checkpoint, restart its live PTYs, launch a second daemon owner, or advertise rollback into an image that cannot restore its state. Pre-daemon first adoption is a separate interruption/approval path, not a session-preserving handoff. The separate [cold source installer](cold-source-install.md) does not establish live-update compatibility.

Recheck task 3.4 only when an identified, validated 32-session source image and the actual compatible trusted updater are available. Required evidence includes pre-commit refusal/rollback with old PTYs and receipts still usable, successful limit expansion and new PTY admission without PID/PTY changes, old-format/downgrade refusal before exec, and packaged-update continuity. Do not replace these with the isolated replacement fixture or host restore test.

### Exit history and operation expiry

Settled exits keep final recovery until the newest-128 history bound displaces them. This is count-based retention after output drain, not a wall-clock TTL or a guarantee that a disconnected consumer will receive every old exit. Live/draining records remain owned. Expired recovery returns `stalePty` or unavailable state; journal consumers must handle an explicit `gap` and reconcile inventory rather than substitute another PTY's history.

Operation receipts have their own bounded retry window: normally 1,024 ordinary receipts, 4 MiB of retained requests, and a separate 128-receipt termination reserve. The ordered client retires definitive results in batches and schedules an idle acknowledgement after 100 ms. That scheduling delay is not a receipt TTL; failed acknowledgements remain pending. Explicit `flush_operation_receipts()` retires only results observed definitively.

Acknowledging an ordered stream advances `retiredThrough`. A retry at or below that watermark, or from a fenced older stream, returns `operationExpired` without executing again. Opening a new controller stream fences old receipts; it is not permission to replay uncertain mutations. Unknown outcomes block ordered traffic and cannot be acknowledged as settled. Receipt expiry and exited-history expiry are separate from resource admission and must not reset PTY or input-sequence identities.

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

The daemon integration test uses the actual packaging manifest writer by default. Set `OPENFORGE_PACKAGED_RUNTIME` to an existing `.app/Contents/Resources/session-runtime` to test the payload copied from that app instead; CI uses this path. The test launches a staged daemon with a live shell, deletes its temporary source bundle, verifies stable daemon lifetime and shell PID/PTY identity after refusal, sends further input, and exercises authenticated registry cleanup. Store tests cover corrupt and incompatible manifests, symlinks, executable permissions, foreign ownership, leases, durable references, and unknown artifacts.

KVG-4728 has native macOS arm64 package and packaged-smoke evidence locally, plus native Intel x64 evidence from [CI run 35535077246](https://github.com/koenvg/openforge/actions/runs/35535077246), job `Packaged Session Runtime (x64)`. That job passed packaging, staged launch/bundle-removal/refusal/cleanup, and packaged Electron smoke on an Intel Core i7-8700B with translation disabled. The `packaged-session-runtime-x64` artifact records the architecture, manifest, daemon SHA-256 (`7c16ab7096c7a3a360b01f856a76e43c9824bb8a49eee2cba1d497dc0472ce25`), and test logs. Production trusted replacement remains deliberately disabled.

`.github/workflows/packaged-session-runtime.yml` runs independently of the broad CI gate, requires native host/Node architectures, rejects Rosetta, and uploads evidence even on failure. Its arm64 job uses `macos-15`; Intel uses `macos-15-intel`. The first arm64 attempt on macOS 15 failed in Whisper/ggml compilation before daemon validation because `vmmlaq_s32` requires `i8mm`. That run remains historical evidence; the portable CPU policy now prevents the unsupported instruction from blocking this workflow.

Validation scope was the scripts, Electron desktop shell, Rust Sidecar, and session host/protocol/client/daemon crates. The unchanged renderer and workspace packages were not rerun as a repository-wide test suite.

- Initial implementation checks passed: 657 scripts tests, 349 Electron tests, root and Electron TypeScript checks, lint, desktop IPC registry checks, workspace metadata, affected Rust test/check/build/clippy/format, native arm64 packaging, optimized launch/refusal, and isolated smoke.
- Follow-up checks passed: the delayed/fragmented mock HTTP regression, all 13 gateway tests, the full post-merge Session Daemon contract command, 448 tests selected by `vitest run electron`, workflow tests and `actionlint`, Electron TypeScript, IPC, metadata, lint, and daemon clippy/format.
- The accepted sockets explicitly use blocking reads; the response fixture collects complete headers rather than assuming one read contains them. The gateway suite passed in all three concurrent full contract copies. Two complete copies passed; the third timed out waiting for provider CLI receipts in separate Sidecar fixtures, tracked by KVG-5151. No suite serialization was added.
- Earlier follow-up full scripts runs exceeded unchanged inventory/Storybook five-second deadlines (KVG-5153). The latest full scripts run passes all 668 tests, including delayed-drain cleanup, deadline expiry, unknown/stale refusals, and credential-safe protocol diagnostics. Earlier failed runs remain recorded rather than counted as passes.
- Existing ignored tests remain ignored except the cross-boundary fixtures explicitly selected by the contract command. Trusted live replacement and the separate updater/source-install transaction were not validated. Native x64 launch evidence is now present; the updated arm64 CI lane still needs a passing run.

### KVG-5263 documentation validation

Only this guide and the capacity change's task checklist changed; daemon, updater and backend behavior were not modified. Against baseline `3a78e2309`, host/protocol/client default and all-feature suites passed with 17/19/20 tests respectively. The all-feature daemon suite passed serially with 334 reported cases, including repeated fixture-binary unit tests, and five ignored cases. Its replacement suite passed 27 cases with three ignored; capacity scaling passed all three. Serialization avoids the earlier load-dependent parallel replacement preflight timeout; it does not prove that timeout fixed.

All four session crates passed all-target/all-feature check, build and Clippy. Host/client/daemon formatting passed. Protocol formatting still fails at unchanged `src/notification.rs:126`, tracked by KVG-5291. The normal default daemon run stopped on `continuity::output_overflow_reports_a_gap_and_keeps_authority_recovery_available` with `RecoveryUnavailable`, after 88 passing cases. Serial all-feature continuity passed unchanged; KVG-5328 tracks the unresolved discrepancy, not a waived failure.

The default run left one new daemon at `/tmp/of-pty-N2f0qv` after fixture teardown removed its runtime root and credentials. Authenticated cleanup is unavailable, so no observed orphan PID was signalled. Process observation found no other new daemon survivors across the subsequent serial workload. Cleanup is not fully verified; KVG-5328 coordinates with KVG-5313's fixture ownership work.

The packaging/manifest and ownership script contracts passed 28 tests; the desktop IPC registry check passed. `packaged_release` passed using the current debug daemon and the actual manifest writer, not an assembled production `.app`. No installed application was touched. No native x64 execution, full packaged-update/legacy acceptance, backend-wide suite, renderer/workspace-wide suite or production package rebuild was run for this documentation-only diff. Those omissions do not establish production compatibility. The strict OpenSpec and whitespace checks passed. Local logs and receipts are in `/tmp/KVG-5263-validation/`.
