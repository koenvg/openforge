# Native Ghostty: existing-session integration

KVG-5198 now has an opt-in Terminal Runtime adapter for one development indexed shell. Xterm remains the default. The user approved the development-only in-process exception to ADR 0005; this is not shipping architecture approval.

**Status: prototype connected; completion remains blocked.** The latest full-app probe passes, but an earlier strict fallback run displayed stale trailing characters after resize. That failure has not been explained. Native pixels and interaction usability remain unverified.

Baseline: `855d845547eaeb8e7625599b15d1a308883ba70a`.

## Paused WIP checkpoint

The work is saved on `openforge/KVG-5198` for continuation, not merge. Start with the intermittent fallback suffix described below, then native visual acceptance, clean aggregate validation and the single completion review. The [task handoff](../../scripts/experiments/native-ghostty-openforge/evidence/integration/handoff.md) records the remaining work and earlier results.

Native checkouts and compiled binaries under ignored `artifacts/` stay local. The committed patches, source manifests and preparation/build scripts recreate them. Xterm remains the default.

## Scope and launch

The current adapter restores the existing **portable VT presentation, compatibility replay and parser continuation**, then accepts live model output. Binary READY and incremental history are deliberately deferred. The native fork still has those prerequisite APIs; the app does not use them yet.

```sh
node scripts/experiments/native-ghostty-openforge/prepare.mjs
node scripts/experiments/native-ghostty-openforge/run.mjs --full
VITE_OPENFORGE_EXPERIMENTAL_GHOSTTY_SESSION='<existing-indexed-shell-key>' pnpm electron:dev
```

The main process also requires an unpackaged macOS ARM64 build. The exact selected key must identify an indexed shell. No global renderer switch or production dependency change was made.

For the isolated full-app probe:

```sh
node scripts/experiments/native-ghostty-openforge/live-session-probe.mjs
```

It first creates fixture output, destroys the attachment by leaving the task, then creates a new native attachment to the **same existing PTY instance**. It does not substitute another PTY for restoration. The probe owns a temporary fixture database/repository. Cleanup verifies the fixture sidecar's app-data path and process identities before stopping its remaining process tree.

## Ownership and byte flow

- `src/lib/desktopNativeTerminalView.ts` selects native only for the opt-in key. `nativeTerminalView.ts` implements the Runtime view contract; `nativeTerminalPlacement.ts` keeps DOM layout authoritative.
- Terminal Runtime still owns PTY creation, lifetime, output subscriptions, recovery and geometry leases. `prepare()` allows native parsed-grid readiness before fitting. A state-losing renderer failure requests refit/recovery from the existing authority.
- `src/electron/experimentalNativeTerminalHost.ts` owns native attachments by window, view ID and generation. BrowserWindow handles come from main, never renderer payloads. Native tokens are independent of renderer generations.
- `experimental_native_terminal` goes through the typed wrapper in `src/lib/ipc/terminal.ts`, the generated IPC registry and the registered main-frame renderer gate. The native input event is typed too.
- Snapshot replacement uses a fresh hidden native owner. Presentation, compatibility and continuation bytes finish before commit/show. Live output must match the committed PTY instance and advance model sequence. Native byte offsets are per-owner parser acknowledgements, not model or presentation watermarks.
- Input remains `string | Uint8Array`. Queued binary input is copied before waiting, serialized as JSON byte arrays, and deserialized by Rust's `PtyInput`. Existing per-shell ordering and restart/controller fences remain in place.
- The native fork classifies user-originated input separately from protocol responses. Native replies remain disabled; the Rust authority responds. The live test observes exactly one DSR response and exact UTF-8 input at the PTY.
- Native live-output buffering is bounded to 4 MiB. Overflow, native failures and unsupported font/theme changes fall back to xterm and request authority recovery. Native presentation/pixel APIs explicitly reject rather than invent evidence.

## Main-thread deadlocks found and fixed

Parsing hosted output synchronously on Electron main can fill Ghostty's app mailbox and then wait forever for main to consume it. A controlled 1,000-title regression reproduces that deadlock. The app now uses `appendAsync`: copied bytes parse on a libuv worker while main services native messages. Owner retention lasts through completion; destruction hides/retires immediately and frees after parsing finishes. State/history operations reject concurrent output.

A second regression quit Electron during that notification flood. AppKit dispatch stopped draining before output completed, so an initial cleanup implementation still hung. Wakeups now use `uv_async_t`, including during shutdown; an asynchronous N-API cleanup hook retains the app until pending output completes. Both the ordinary and quit-with-pending-output probes pass. Render callbacks defer work instead of reentering Ghostty under native locks.

Hiding is independent of parsing/resize. A dialog, retained pane, transparent/hidden ancestor or DOM occlusion hides the native view without waiting for queued output. Hidden-owner input is rejected. Unmount/navigation/window cleanup releases ownership without treating a view's teardown as PTY death.

## Evidence and remaining failure

The latest isolated test verifies:

1. A different native attachment ID restores the marker from the same PTY instance.
2. Switching to Files hides native content; returning shows it without replacing the PTY.
3. The PTY receives exactly `1b5b306e` for DSR and `68c3a9f09f9982` for native `hé🙂` input.
4. Native parsed geometry settles after resize, with live output and the PTY preserved.
5. Destroying the native owner triggers xterm authority recovery, where the whole-line marker is found.

**The fifth assertion previously failed.** The Chromium screenshot showed `FALLBACK-RECOVEREDE` rather than the expected whole line, plus retained command-tail text elsewhere. A subsequent run passed without a restoration fix. Keep this as an unresolved, potentially timing-sensitive resize/replay issue, not a fixed bug or a reason to weaken the assertion. Determine whether the suffix is already in authoritative state, introduced by geometry/replay ordering, or specific to the adapter; compare against an xterm-only control.

The harness sends text through native paste/text encoding and Return through native key encoding. It does not automate physical keyboard input. Chromium screenshots omit the AppKit/Metal subview; the screenshot showing the failure was of the xterm fallback. Previous native screen capture lacked Screen Recording permission. Neither inspection text nor `visible`/grid state establishes correct native pixels.

Current durable evidence is under [`evidence/integration`](../../scripts/experiments/native-ghostty-openforge/evidence/integration). Earlier prerequisite reports remain historical; do not apply their hashes or validation claims to this production integration.

## Validation

- Native `--full`: all 12 runner checks passed, including strict Objective-C/Objective-C++ compilation, authority/Electron probes and quit-with-pending-output. Full suite: **3,326 passed, 16 skipped**, 84/84 steps, 661,056 ms. The patch records 18 source hashes at the unchanged production Ghostty pin.
- Terminal Runtime package: **59 files, 302 tests passed, 1 skipped**; build/typecheck passed. New renderer/host/placement/Runtime behavior checks: **7 passed**.
- Renderer/Electron typechecks, root lint and generated IPC registry check passed.
- Broad app/script/workspace run: **827 files passed**, seven failed and three skipped. Five import/mock failures and the IPC-domain ownership failure were fixed by lazy native-port creation and keeping the wrapper in the existing terminal domain; the focused rerun passed **26 tests across seven files**. The unrelated browser-controls timeout passed its isolated **24-test** rerun. A full rerun with four workers timed out; it is not a clean aggregate pass.
- Rust backend: initial full run had one document-preview timeout. The four-thread full rerun passed **2,371 tests, 49 ignored** across its binaries/integration suites. `cargo check` and `cargo clippy` passed. The live harness also builds the actual backend.
- No production packaging, new native pixel/presentation conformance, sanitizer/fault-injection matrix or independent hardware run. The single fresh completion review has not run: restoration consistency and aggregate validation still block completion.

## Follow-up within this task

Reproduce the fallback suffix without changing its whole-line assertion; retain authoritative snapshots, dimensions and watermarks around the native-to-xterm transition. Verify genuine native pixels and keyboard/pointer behavior. Finish clean affected-system validation and the required single fresh review before declaring the integration complete.

Binary checkpoint eligibility/atomic adoption, incremental history, Kitty resource transfer, restored input-mode coverage, clipboard/IME/accessibility, app shortcuts, settings/display integration, isolated shipping architecture and presented-frame accounting remain separate unproven stages. Image-bearing binary exports still fail closed; portable image recovery is not established. Existing cleanup tasks KVG-5214, KVG-5225 and KVG-5201 are unchanged.
