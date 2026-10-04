# Native Ghostty window experiment

An isolated AppKit window using full Ghostty's Metal renderer and the host-owned snapshot fork. **This is a synthetic stream, not a shell or an OpenForge session.** Launching OpenForge normally still uses its production renderer.

## Try it

From the OpenForge repository root:

```sh
node scripts/experiments/native-ghostty-window/prepare.mjs
node scripts/experiments/native-ghostty-window/run.mjs
```

Requires macOS ARM64, Zig **0.16.0**, Node, Git and the Command Line Tools/macOS SDK. Preparation needs network access for missing sources/packages. No Xcode installation or `metal` command is required: this fork compiles the unchanged Ghostty shader source through the runtime Metal API. That path was tested on an Apple M5, not other hardware or macOS versions.

The first build takes longer; subsequent builds reuse the cache. Close the window or press **Cmd-Q** to exit. Logs and binaries live in `artifacts/terminal-presentation/native-ghostty-window/`.

### Controls

1. Start with **2,000 history lines** and a live counter. Scroll to inspect the native terminal.
2. Click **Checkpoint & restore**. The replacement surface adopts READY before it is inserted into the window. It does not replay the old VT stream.
3. Leave **Live output** enabled and click **Load one page**, or **Load remaining**. Older pages are applied to the same native terminal that receives the live counter.
4. Resize while history is pending to explore incompatible-history handling. FINISH does not imply every row was recovered; the footer reports applied rows and history loss.
5. Click **Add image** to send a small Kitty checkerboard. A subsequent checkpoint must be refused: image resources are not serialized by this prototype.
6. **Reset fixture** discards the demo state and starts again.

Typing exercises native input encoding and the host callback; the footer reports received bytes. It does **not** execute commands or echo a shell. Clipboard, IME and a terminal accessibility adapter are not implemented. Use the default font size: the adopted snapshot must match the new surface's grid, and this demo does not inherit arbitrary per-surface settings.

## Verification

```sh
# Build without opening a window
node scripts/experiments/native-ghostty-window/run.mjs --build-only

# Real native Surface/C API integration test, then focused headless tests
node scripts/experiments/native-ghostty-window/run.mjs --test

# Also run the full upstream native test suite (allow around 10 minutes)
node scripts/experiments/native-ghostty-window/run.mjs --full
```

The GUI integration test opens and closes its own window. It checks active text through Ghostty's public text API: READY equality, live output, history, stale/gapped output rejection, malformed snapshot rejection without replacing the original surface, ten additional adoption/teardown cycles, the expected input-byte count through the running native I/O thread, cancellation, and image-export refusal.

**It does not verify pixels or first-correct-frame latency.** A separate preview window opened, but screenshot capture failed because this session lacks macOS Screen Recording permission. That permission is only needed for screenshot verification, not for you to open the demo and inspect it. Scrolling, selection, resizing, image pixels and transition quality still need visual checking.

Retained results: **86/86 focused tests**, **3,817 passed and 25 skipped** in the full upstream suite, native library build **116/116 steps**, and the GUI state test passed. Commands, hashes and logs are in [`evidence/report.json`](evidence/report.json); setup failures and the screenshot blocker are in [`evidence/development.json`](evidence/development.json).

## Reproduction and boundaries

- The baseline is [`../native-ghostty-fork/host-snapshot.patch`](../native-ghostty-fork/host-snapshot.patch). Apply [`hosted-window.patch`](hosted-window.patch) after it, at upstream `4ae9f1a2de5484de3d6a13fe03676b8853b9c41c`.
- `source-manifest.json` checks both patches and all 16 resulting changed files. Preparation refuses unexpected local edits. Both patches were applied to a clean pinned checkout and matched the tested sources; repeated preparation also passed.
- `GHOSTTY_WINDOW_ROOT` may select another directory under this repository's `artifacts/`. Use the same value for preparation and execution; do not reuse the headless fork checkout.
- The runner resolves the physical package directory before passing `--system` to Zig. A symlink path caused `uucode_generate` to fail with `FileNotFound` during development.
- The new C functions live in the experimental `ghostty-hosted.h`, not upstream's supported API. Calls run on the main thread; callbacks may run on native I/O threads and must not reenter Ghostty. Callback userdata must survive until `ghostty_surface_free` has joined native threads.
- No production renderer, transport, dependency pin or lockfile changes. No PTY, real-session attach, Electron embedding, production reply authority, image checkpoint transfer, presented-output watermark, or cross-version snapshot compatibility is established.

Findings and next gates: [`docs/experiments/native-ghostty-window.md`](../../../docs/experiments/native-ghostty-window.md).
