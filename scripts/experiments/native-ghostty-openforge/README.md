# Native Ghostty existing-session prototype

The approved development-only in-process addon now connects one opt-in indexed shell through Terminal Runtime. Xterm remains the default. **Completion is blocked:** a strict native-to-xterm fallback test has shown unexplained trailing characters after resize, even though its latest rerun passes. Native pixel/interaction acceptance and the completion review are still pending.

The addon can crash Electron. Do not package it or expose native pointers to renderer code. Main obtains BrowserWindow handles and owns attachment identity/lifetime. The hosted native backend creates no PTY or child; Terminal Runtime retains those responsibilities.

## Run

Requires macOS ARM64, Zig 0.16.0, Node/N-API headers, installed Electron dependencies and prepared production Ghostty/Rust caches. CLI Metal is unnecessary.

```sh
node scripts/experiments/native-ghostty-openforge/prepare.mjs
node scripts/experiments/native-ghostty-openforge/run.mjs --full
# Actual app, isolated fixture, existing-PTY reattachment and forced fallback:
node scripts/experiments/native-ghostty-openforge/live-session-probe.mjs
# Manual development opt-in:
VITE_OPENFORGE_EXPERIMENTAL_GHOSTTY_SESSION='<existing-indexed-shell-key>' pnpm electron:dev
```

Use `node scripts/prepare-ghostty-vt.mjs` first if production caches are absent. Cargo runs locked/offline. `NODE_INCLUDE_DIR` overrides Node headers. Run with explicit Node, not Bun.

Artifacts live in `artifacts/terminal-presentation/native-ghostty-openforge/`. `GHOSTTY_OPENFORGE_ROOT` selects another root under repository artifacts; use it consistently. The native source is `pinned-upstream`, packages are `packages-pinned`, and source edits are verified rather than reset.

## Contracts

`hosted-openforge.patch` applies directly to unchanged production Ghostty `22d13172cde98a0a4dda05d3d6a3fcb0dd8ed018`, with 18 source hashes. Do not stack earlier patches. The former newer-revision fork could not decode production BLAKE3 READY/FINISH records; this rebase preserves checksums and backend pins.

The app currently restores portable VT presentation, compatibility replay and parser continuation, **not binary READY/history**. A new hidden owner is committed before live bytes/show. PTY instance, model sequence, view generation, native token and per-owner byte offset remain distinct. Native offsets acknowledge parsing, never presentation.

User input is classified at source and preserved as bytes across N-API, desktop IPC and Rust. Native protocol responses stay disabled. Clipboard, native focus/resize reports and unsupported input modes need further integration; do not infer full terminal compatibility from the typing/DSR tests.

`appendAsync` copies output to a serialized libuv worker. App wakeups use `uv_async_t` so mailbox draining continues during shutdown. Retired owners remain allocated until output completion; async N-API cleanup joins ownership before freeing the app. Render callbacks must not synchronously reenter native code. Synchronous `append` is retained only for the controlled deadlock regression—never use it for arbitrary output.

Main-only operations include initialize/create/inspect/snapshot/nextHistory/destroy/setBounds/focus/hide/submitText/pressKey. State/history operations reject pending output; hide and retire do not wait for parsing. Inspection exposes parsed state and native visibility, not framebuffer pixels. Input queues and renderer output buffering are bounded; failures request xterm recovery from the existing authority.

## Evidence

The prerequisite runner exercises production-codec restore, native reply suppression/input, Electron ownership and pending-output shutdown; it creates no PTY. `--full` additionally runs native tests. `live-session-probe.mjs` uses actual OpenForge, its backend and Runtime, creates fixture output, detaches, and restores a different view onto the same PTY. It also checks pane hiding, exact input/reply bytes, resize and forced fallback. It retains a strict whole-line fallback assertion; do not weaken it to hide the intermittent suffix failure.

The controlled red probe uses `GHOSTTY_SYNC_OUTPUT_RED=1`; it is expected to deadlock and requires an external hard timeout with verified process-tree cleanup. `GHOSTTY_EXIT_PENDING=1` tests graceful quit during output and must exit successfully; the runner includes this case with a 15-second bound.

Chromium screenshots omit AppKit subviews. State tests, visibility properties and redraw requests do not prove native pixels or usability. Image-bearing binary exports fail closed; portable image recovery, IME/clipboard/accessibility, shortcuts, complete pointer/settings/display behavior and production isolation/packaging remain unresolved.

See [current findings](../../../docs/experiments/native-ghostty-existing-session.md), [historical prerequisites](../../../docs/experiments/native-ghostty-electron-bridge.md), and `evidence/integration/`. Historical `evidence/report.json` predates production integration and must not be treated as current validation.
