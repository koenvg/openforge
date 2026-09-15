# Terminal recovery proof

KVG-4715 extends the KVG-4714 experiment. The release gate remains **incomplete**. No production daemon extraction or renderer migration is authorized.

KVG-4717 subsequently received an explicit owner exception for one controlled daemon-hosted indexed shell and Sidecar-only replacement. See [the slice contract](../../../docs/session-daemon-shell.md). The daemon itself is not replaced; the broader feasibility and production enablement gates below remain open.

## KVG-4726 arm64 scope and integrated image preflight

The owner removed all macOS x64 work from KVG-4726. This task requires only arm64 builds and execution evidence. Earlier x64 requirements below record the original parent scope; they no longer block this task. The remaining arm64 feasibility gates still apply. No production daemon replacement has been enabled.

The isolated Rust authority owner now combines its real Ghostty checkpoint and PTY with image preflight. Before changing the checkpoint or descriptor flags, it checks both the target and retained recovery image. Only thin arm64 Mach-O executables are accepted. A child probe receives null stdin/stderr, a bounded stdout pipe, no inherited host environment and no session/checkpoint descriptors. It must return compatible protocol, checkpoint-format, authority-codec and architecture metadata within two seconds and 4 KiB. Every probe is reaped. Nonregular files are opened nonblocking and refused; scripts are refused without execution.

The private checkpoint format is now version 2 because it retains activation outcomes. An actual failed exec leaves the old owner serving and reports failed activation. Controlled initialization failure reexecs the retained compatible image before installing the model or consuming PTY I/O, and still reports failed activation. The resumed executable checks its actual version against the prepared version; a changed compatible target falls back rather than reporting the wrong version active. These are fixture contracts, not production protocol or state-format compatibility promises.

### Evidence

- [Initial refusal regression](evidence/macos-arm64-integrated-preflight-red.json): incompatible and unresponsive regular-file targets incorrectly reached the preparation barrier before implementation. Cleanup was graceful with zero survivors.
- [Complete green run](evidence/macos-arm64-integrated-preflight-green.json), [repeat 2](evidence/macos-arm64-integrated-preflight-repeat-2.json), and [repeat 3](evidence/macos-arm64-integrated-preflight-repeat-3.json): nine tests and ten clean session teardowns per run. Tests cover missing/malformed images, incompatible metadata, probe isolation, timeout/output limits, scripts, FIFOs, unusable recovery images, failed exec, changed target version, explicit controlled-fallback failure, parser/query recovery and numbered output under pressure.
- [Authority-discard negative control](evidence/macos-arm64-integrated-preflight-negative.json): both parser cases fail with the expected missing `ALTRED` and wrong query column. Both cleanup audits have zero survivors.
- Every pressure run receives all 4,096 numbered lines without gaps or duplicates. Across the three runs, request-to-ready is 513 to 782 ms, GO-to-ready is 41 to 43 ms, and the longest producer write is 542 to 811 ms. These include debug-build and driver overhead plus a deliberate 201 to 210 ms pause. They are not production latency guarantees. The unresponsive-image refusals take about 2.05 seconds.

```sh
node scripts/experiments/pty-reexec/live-authority-proof.mjs \
  --report /tmp/authority-preflight.json
# Focus only the image/refusal/failure cases.
node scripts/experiments/pty-reexec/live-authority-proof.mjs \
  --report /tmp/authority-preflight-focused.json Preflight
```

Affected-system checks pass: all 51 imported Rust authority tests across three binaries; Cargo format, check, build and clippy with warnings denied; ten C/Python live tests; seven teardown regressions; the nine-test Rust-owner live suite; the no-replacement pressure control; all four production-view presentation probe cases; Python compilation, Node syntax and Clang analysis of every C fixture, including burst mode. Desktop, Sidecar and plugin suites were not rerun because this slice changes only the isolated experiment. Their checks remain required when production code changes.

### Remaining limits

The probe is synchronous in this fixture: it does not demonstrate concurrent old-host request servicing during preflight. Image headers and declared contracts are not signature verification, immutable installation, tamper protection or a combined state decode in the target probe. Arbitrary target/fallback corruption, fatal loader failure and loss of the sole PTY-owning process remain unrecoverable.

The experiment still lacks the combined listener/lock/credential and notification-journal protocol, concurrent accepted-input accounting, stale-controller/duplicate-request handling, tested global retained-state budgets and supported-image state through reexec. The temporary post-restore checkpoint refusal remains. Production daemon PTY-wrapper reconstruction and quiescence are not implemented by this fixture. These gaps must be closed before production replacement proceeds.

KVG-5062 tracks existing error handling in `live_native.rs` teardown: failed signals/close/reaping can be reported as success. This slice leaves that adapter unchanged and retains independent survivor audits.


## KVG-4760 owner-approved recovery contract

The owner confirmed this focused production fix. Ghostty captures portable VT, bounded compatibility/image replay, explicit parser continuation and the output watermark in one actor command. Continuation comes from Ghostty's replay-safe continuation API, not from a guessed retained-output suffix. Unavailable continuation still defers the snapshot without disabling the authority.

The xterm view drains earlier writes and resets its presentation and image addon. It replays compatibility data, sends byte CAN to cancel unfinished replay parser and UTF-8 input, repaints portable VT, and restores the explicit continuation last. Only then can the coordinator flush output newer than the snapshot watermark. A live snapshot missing continuation is refused; empty continuation explicitly means parser ground. Ghostty remains the only source of PTY protocol replies.

The parent probe now bundles the actual production `createXtermTerminalView` and calls `replaceSnapshot` and `writeLive`. It uses JSDOM and public presentation captures, not a second implementation of recovery ordering. Its four fixtures use the view's default 80-by-24 geometry. The earlier red report used 20-by-4 xterm terminals and remains unchanged.

Run the updated probe without overwriting the historical red evidence:

```sh
node scripts/experiments/pty-reexec/authority-proof.mjs \
  scripts/experiments/pty-reexec/evidence/macos-arm64-continuation.json
```

All four arm64 cases pass through the production view: split CSI, split UTF-8, alternate-screen return, and split query. No renderer replies reach the input callback. The binary Ghostty checkpoint comparisons also pass. The probe does not mount the desktop, test pixels, test images, cross IPC, or replace a live terminal model process.

`packages/terminal-runtime/src/xtermTerminalRecovery.integration.test.ts` separately exercises the real view and xterm image addon. It checks text, color, cursor, UTF-8, query suppression, image retention, alternate-screen return, and refusal without clearing when continuation is absent. Both desktop and Trusted Plugin adapter tests check continuation transport. The actor test checks continuation and ground state at distinct watermarks; existing overflow tests check deferred recovery.

The arm64 PTY rerun is recorded in `evidence/macos-arm64-continuation-pty.json`. Nine live tests and seven teardown tests pass. These independent process and descriptor observations still use the isolated PTY experiment, not a production daemon.

The parent gate is still incomplete. No macOS x64 execution is available. Supported-image coverage here is an inline-image fixture, not proof of arbitrary image-state retention beyond the compatibility budget. The broader stop-rule gaps listed below remain open.


## Initial failure and owner decision

The original authority probe failed three presentation cases with only 14–15 bytes of input, well within the 256 KiB compatibility budget:

| Case | Binary authority checkpoint | Original presentation recovery |
| --- | --- | --- |
| Split CSI, `BEFORE ESC [ 31` then `mRED` | Matched tested state and replies | `BEFOREmRED` instead of `BEFORERED`; color differed |
| Split UTF-8 emoji | Matched tested state and replies | Emoji disappeared |
| Alternate screen then return to primary | Matched tested state and replies | Matched |
| Split cursor-position query | Matched tested state and replies | `6n` appeared as text |

[The original arm64 failure report](evidence/macos-arm64-authority.json) is retained unchanged. Its hashes identify the old source state. The binary checkpoints were 1162 to 1320 bytes, not proof of a global state budget or image preservation.

Implementation stopped for owner review. The owner then authorized fixing continuation recovery, first as KVG-4760 and subsequently within KVG-4715. The separate run was stopped and its unfinished changes transferred here. A backup of its patch, files, history and task notes is at `/Users/koen/.openforge/handoffs/KVG-4760-jbue_9nq`. Task deletion was requested but the CLI returned HTTP 409 because KVG-4760 remains in `doing`; its dependency on this work was removed. No separate implementation is still running.

## Current recovery contract

Ghostty remains the parsed-state and query-response authority; xterm remains the renderer. The actor captures portable VT, bounded compatibility replay, parser continuation and output watermark in the same command. The existing continuation limit and unavailable-checkpoint behavior remain in force.

`continuationData` carries base64-encoded parser continuation across the Sidecar and plugin snapshot boundaries. Empty continuation means parser ground. Terminal Runtime preserves it with the snapshot's PTY identity and watermark.

Presentation recovery now:

1. Drains pending renderer writes and resets xterm and retained image state.
2. Feeds compatibility replay, then a byte-oriented CAN to cancel its unfinished parser/UTF-8 input before painting portable VT.
3. Feeds canonical portable VT.
4. Feeds the captured parser continuation.
5. Applies only later output accepted by the existing instance and watermark checks.

Real xterm view regressions cover split CSI, UTF-8 and queries, including absence of renderer-generated input. An actor test verifies continuation belongs to its captured watermark and disappears when the parser returns to ground. Desktop and plugin adapter tests exercise the extended transport. This is a focused recovery fix, not a new PTY owner or an image checkpoint format.

Run the probe after `pnpm i`:

```sh
node scripts/experiments/pty-reexec/authority-proof.mjs \
  scripts/experiments/pty-reexec/evidence/macos-arm64-continuation-green.json
```

The standalone Rust crate compiles OpenForge's actual authority modules unchanged. Its binary-codec comparison continues original and decoded models and compares portable state and subsequent replies. The rebased Node probe retains main's production `createXtermTerminalView` implementation in JSDOM, described above, rather than duplicating recovery ordering. The older `macos-arm64-continuation-green.json` records the pre-rebase probe; its hashes identify that historical source state.

These checks establish only the exercised continuations. They do not prove complete parser equivalence for arbitrary inputs. Neither screenshots nor a raw suffix are accepted as a complete parser checkpoint.

## Live failure handling established on arm64

```sh
python3 scripts/experiments/pty-reexec/run.py \
  --report scripts/experiments/pty-reexec/evidence/macos-arm64-recovery-green.json
python3 -m unittest discover -s scripts/experiments/pty-reexec -p 'test_*.py' -v
```

The current live report has ten passing tests and zero survivors in all ten cleanup audits. Seven teardown regressions pass. New incompatible-target and controlled-initialization tests failed before implementation; their red reports are retained beside the green report.

The fixture probes target state-format and structure-size compatibility in a child that closes inherited descriptors and binds stdio to `/dev/null`. A probe must exit successfully within roughly two seconds or preparation is refused. It does not authenticate or code-sign an executable and is not production preflight.

The invalid-target regression covers executable text without a valid image header, a truncated Mach-O image, a valid image without execute permission, a missing path, a directory and a probe that never responds. Each is refused within four seconds, retaining the complete reported inventory, descriptor set and process-start identities. The test checks that no probe child remains, accepts one observed agent response after each refusal, and finishes with a successful compatible replacement. It does not establish signature verification or resistance to a malicious executable that forks descendants.

`macos-arm64-preflight-negative.json` records a temporary-copy mutation disabling only the checkpoint probe. All six refusal assertions fail with `prepared: true`; every unexpected preparation is aborted, and cleanup leaves no survivors. The report's `sourceMutation` describes the altered condition. Its ordinary `negativeControl` flag remains false because that flag means disabling reexec, not disabling preflight. `macos-arm64-preflight-green.json` records the first passing focused run. Reports preserve the source hashes of their respective stages.

The broader rerun exposed an existing echo-test problem. Shell checks left the separate agent PTY unread long enough for macOS to discard kernel echo, although the agent received and answered the input. `macos-arm64-echo-failure.json` preserves that run. A no-reexec control with three seconds of deliberate reader starvation reproduces the failure in `macos-arm64-echo-control.json`. The test now services the agent PTY before asserting echo. The same paused no-reexec control then passes in `macos-arm64-echo-serviced-control.json`, and the complete ten-test live suite passes. Echo, agent response and complete numbered tool output are still asserted. This does not establish lossless kernel echo during arbitrary output saturation.


An incompatible executable is refused before modifying the live checkpoint or descriptor flags. Removing a target after preparation exercises an actual failed `execl`, leaving the old image usable. Controlled failing v2 reads the checkpoint, increments a recovery counter and reexecs retained v1 before acquiring PTY wrappers or consuming I/O. Tests observe the final executable, host PID, child start identities, PTY descriptors, slave paths, devices and cursors. A post-recovery input has one observed response, and a later compatible v2 replacement works.

The allowlist remains stdio, the unlinked checkpoint and owned PTY masters. The fixed-size native checkpoint adds a format tag, bounded recovery-image path and recovery counter. It is not a portable state protocol. Terminal state, listeners, ownership locks and ingress journals are not embedded in it.

The isolated directory retains both images until cleanup. Missing/corrupt recovery images, fatal loader failure, SIGKILL or arbitrary fatal initialization crashes cannot be rescued by this checkpoint. Losing the last PTY master is fatal to continuity. No extra PTY-holding process or descriptor-transfer architecture was introduced.

## Actual authority and pressure across live reexec

`live-authority-proof.mjs` builds two isolated Rust owners using the production Ghostty model and snapshot codec. Each owns one real PTY and an unlinked checkpoint descriptor. The same process resumes from the binary checkpoint after exec; no presentation replay is used to recover the authority. The private control protocol is serialized, with synchronous accepted writes and protocol replies before preparation.

```sh
node scripts/experiments/pty-reexec/live-authority-proof.mjs \
  --report scripts/experiments/pty-reexec/evidence/macos-arm64-live-authority-green.json
# Expected exit 1: discard the authority checkpoint in the parser cases.
node scripts/experiments/pty-reexec/live-authority-proof.mjs --negative-control \
  --report scripts/experiments/pty-reexec/evidence/macos-arm64-live-authority-red.json
# Keep the pressure producer and deliberate pause, but omit its replacement.
node scripts/experiments/pty-reexec/live-authority-proof.mjs --pressure-control \
  --report scripts/experiments/pty-reexec/evidence/macos-arm64-live-authority-control.json
```

The green run passes two tests covering three sessions, with zero survivors in all three cleanup audits. Both ordinary replacement and injected initialization failure followed by retained-image recovery preserve host/child start identities, descriptor numbers, interrupted CSI, the exact subsequent cursor-position reply, alternate and inactive primary screens, accepted-write/reply counts and resized geometry. A later replacement also succeeds. The negative control fails both parser cases: it prints `mRED` and replies with column 5 instead of column 7. Its cleanup audits also have zero survivors.

The pressure case receives all 4,096 numbered lines in order, without gaps or duplicates, across replacement. Each report records total PTY bytes, checkpoint size, the deliberate 200 ms read pause, request-to-ready and GO-to-ready times, and the longest producer write. Timings include the driver's process observations and diagnostic snapshot, not just exec. These debug-build measurements prove exercised backpressure, not a production throughput or pause SLA. The no-replacement pressure control also passes. Initial diagnostic replay of the entire scrollback timed out in both control and replacement runs; profiles located the time in Ghostty debug integrity checks during the diagnostic clone's `vt_write`. Inventory now inspects a decoded binary clone instead. The timeout reports and profiles remain in the handoff backup.

A new limitation is explicit: immediately after decoding an incomplete parser, the selected model temporarily refuses another checkpoint with `ContinuationUnavailable`. The fixture verifies refusal leaves the session and descriptors usable; finishing the sequence permits a later checkpoint. This is **not** proof of arbitrary repeated replacement at every parser boundary. The compatible-replacement contract must account for this restriction before extraction.

The Rust fixture caps its serialized checkpoint at 64 MiB and its control lines at 8 KiB. This is a one-session experiment, not a tested global host-state budget. Its controlled fallback runs before installing the decoded model or consuming PTY data. It does not combine the C fixture's executable compatibility probe, listeners, ownership locks, image state, concurrent ingress or arbitrary initialization failure recovery. Presentation-only diagnostics may use portable VT while another binary checkpoint is unavailable; the live authority never does.

## Validation and remaining work

Passing validation for the continuation repair:

- Terminal Runtime: 232 tests pass, one skipped; package type check passes.
- Plugin SDK: build and published-contract checks pass; all 439 tests pass on a bounded-worker rerun after one browser timeout in the initial run.
- Terminal plugin: 39 tests and bundle build pass.
- Root TypeScript and desktop IPC registry checks pass.
- Focused real-view and desktop/plugin adapter tests: 18 pass.
- Backend: 1963 unit tests pass, one ignored; four integration tests pass. Cargo check, build and clippy pass.
- Terminal presentation conformance: 33 semantic checks and 13 visual baselines pass. This covers existing renderer/image behavior, not image recovery through live authority reexec.
- Current isolated C/Python regression: ten live tests and seven teardown tests pass; all ten live cleanup audits have zero survivors.
- Current isolated Rust crate: 17 imported authority tests pass in each of its three binaries; check, build and clippy with warnings denied pass. The live authority, no-replacement pressure control and four presentation probes pass. The intentional authority-discard control fails only its two parser cases.
- New Rust formatting, C syntax checks in both fixture modes, Python compilation, Node syntax and `git diff --check` pass.

Rebase validation against main `48572233` retains main's newer production-view probe, image/refusal tests and continuation fixtures. Duplicate continuation fields introduced by automatic merging were removed. The full Terminal Runtime suite and type check, 15 desktop adapter tests, four production-view probe cases, two live-authority tests, seven cleanup regressions and the isolated Rust tests/check/clippy pass after rebase. Reports checked in before the rebase retain their historical source hashes; fresh local probe reports are `/tmp/KVG-4715-rebased-continuation.json` and `/tmp/KVG-4715-rebased-live-authority.json`. Full desktop/backend/plugin suites and x64 execution were not rerun for this conflict resolution.

The broad-suite timeout gap is resolved: with four workers and an external progress reporter, all 4,842 renderer tests pass, with 14 skipped. The full root suite finishes with 5,877 passing tests, 14 skipped and one existing UI inventory failure in unmodified `src/components/attention/AttentionOverviewDialog.svelte`. Root lint reports existing classes in that same file. Those failures are not waived or claimed green. The earlier missing continuation transport fixtures were corrected and their focused suite passes. Logs and the external reporter are retained in the handoff backup directory. The final fresh Astra review, `2360b6bf-b003-4e13-b708-63f317b1d1a1`, approved the complete working-tree slice from `2a4876ca5b6b477f3791d914c21587f89679aa72`, including untracked files and the refusal/echo-test changes, with no merge-blocking findings. It independently checked evidence hashes, seven cleanup regressions, Python/Node/C syntax and whitespace, but did not rerun live, Rust, browser or full subsystem suites. This approval does not clear the broader replacement gate.

The parent gate still lacks macOS x64 execution, full exactly-once input accounting under I/O races, listener/lock retention, tested global retained-state budgets and supported image-state preservation across replacement. Malformed-executable refusal now has arm64 coverage in the C fixture, but is not integrated into the Rust authority owner. The new one-session burst and partial-parser tests do not establish arbitrary repeated checkpoint availability, renderer recovery under pressure, release-build performance or a combined host contract. Existing low-rate numbered-output and exit-race tests do not replace these requirements.

The original design stop rule and both-architecture requirement remain intact. A factual design update is still pending owner confirmation. No app restart, installation or production process cleanup was used as a test. Only the owner-authorized KVG-4760 run was stopped to transfer its work here.
