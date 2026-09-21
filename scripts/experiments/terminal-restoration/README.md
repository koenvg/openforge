# Task terminal restoration, KVG-5199

## Decision

Ship concealment, not screen-first history loading.

The terminal now keeps intermediate restoration frames invisible while preserving layout and renderer activity. It reveals the completed screen after parsing and rendering. This does **not** accelerate replay, fetch, or base64 decoding.

The bounded native experiment succeeds through Ghostty READY and FINISH using the existing pinned Rust bindings. Production screen-first restoration is a **no-go with the current xterm frontend**. xterm has no public operation for prepending older history to an already-live terminal. Native decode speed alone does not solve that problem.

No production renderer, backend snapshot protocol, or dependency pin was replaced. KVG-5198 was used as a scope reference only and remains unchanged.

## Reproduction and baseline

The fixture contains 30,000 ANSI-colored lines and 60 supported inline images, followed by a known final screen. Its 28,401,599 input bytes have SHA-256 `fb86424b2d0f69145af29606307336e582776d45085ea7b4c48d48001ef12c53`.

A text-only preliminary run did not expose intermediate historical screens. The inline-image fixture reliably did: asynchronous image parsing gives the renderer opportunities to paint partial replay. These are real xterm renderings, not simulated scrolling.

The baseline was recorded before production changes at `3bdc8e0af7c5182c3a862389516767e72dea32a0`. Arc ran Chromium 153.0.8010.53 on macOS ARM64, Apple M5, DPR 1. The same input bytes were used for every comparison and for the native prototype.

Selected actual frames:

- [Historical output exposed before the fix](evidence/baseline-history.png)
- [Replay concealed without collapsing layout](evidence/concealed-replay.png)
- [Completed screen revealed](evidence/completed-screen.png)
- [Supported inline image and correctly ordered live output](evidence/image-and-live-output.png)

[Measurements](evidence/measurements.json) retain both after-change trials, including the slow WebGL trial. Raw per-frame semantic samples, screencast PNGs, complete reports, generated fixtures, and check logs are under the ignored `artifacts/terminal-restoration/` directory. Screencast frames are coalesced by the browser; their clock differs from the renderer sample clock.

### Browser observations

All times are milliseconds. History completion is the end of snapshot parsing. Usable-screen time includes fetch, decoding, parsing, the presentation drain, and reveal readiness. It is not a hardware input-to-photon measurement.

| Run | Fetch + JSON | Base64 decode | Replay parse | History complete | Usable screen | Visible historical samples |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline WebGL | 107.8 | 820.3 | 395.1 | 1323.2 | 1334.5 | 58 |
| Concealed WebGL, trial 1 | 94.6 | 969.4 | 1020.7 | 2084.7 | 2090.8 | 0 |
| Concealed WebGL, trial 2 | 65.2 | 819.5 | 362.1 | 1246.8 | 1256.4 | 0 |
| Baseline fallback | 65.5 | 823.8 | 838.2 | 1727.5 | 1738.4 | 131 |
| Concealed fallback, trial 1 | 66.3 | 909.7 | 718.6 | 1694.6 | 1708.9 | 0 |
| Concealed fallback, trial 2 | 62.2 | 842.9 | 672.7 | 1577.8 | 1587.1 | 0 |

These are observations from a shared desktop, not a statistically controlled acceleration or overhead estimate. The slow WebGL trial rules out presenting the faster trial as a speedup. Concealment removes visible playback; it leaves the replay algorithm intact.

Compare within each renderer. At the same 960-by-540 CSS size, this browser fitted WebGL to 132 columns and fallback to 118, both with 22 rows. Each renderer's before/after geometry matched. Host dimensions stayed measurable throughout concealment.

Maximum sampled animation-frame gaps during replay were 26 ms before and 47.7/29.5 ms after with WebGL, and 13.2 ms before and 13.5/15.3 ms after with fallback. Sampling starts **after** decoding. The synchronous base64 conversion itself blocked for roughly 0.8–1.0 seconds and remains unfixed.

Sampled JS heap usage rose from 7.76 to 250.52 MiB in baseline WebGL and from 7.78 to 270.95 MiB in the second concealed WebGL trial. Fallback samples were 7.21 to 80.92 MiB before and 7.23 to 62.13 MiB after. GC timing and renderer allocations vary; these are neither peak memory nor total process RSS. A shared Arc process cannot supply isolated native RSS for one terminal tab, so that metric is unavailable rather than zero.

Fetch measures a local HTTP fixture plus JSON parsing, not production IPC. Base64 decoding is distinct from Ghostty binary snapshot decoding. The synthetic fixture is intentionally large, not a claim about typical task history sizes.

## Production changes

`packages/terminal-runtime/src/xtermTerminalView.ts` keeps the host at `opacity: 0` during restoration. It does not use `display: none` or `visibility: hidden`, so fitting and hidden-frame rendering continue. The host is inert while concealed, preventing accidental input and scrolling through unseen replay. Requested focus is deferred without stealing focus from another control.

Snapshot writes still occur in their original order: compatibility replay, parser cancellation, authoritative portable VT, then parser continuation. Each stage waits for xterm's write callback. Replacement and attachment generations fence later stages and delayed reveal callbacks. Empty snapshots into an unused terminal and ordinary live writes have no new loading timer. Clearing previously painted output still waits for a clean frame.

`replaceSnapshot()` remains a parsing boundary, allowing the authority coordinator to flush queued live output in order. `drainPresentation()` also waits for reveal readiness. A restored offscreen or not-yet-mounted view can reveal when it becomes presentable. Hiding cancels unfinished restoration, but preserves completed state so a simple remount can reveal it after repainting. PTY replacement explicitly invalidates completed state until fresh authority arrives.

The runtime explicitly invalidates pending snapshots when the PTY generation changes. A new spawn or restored PTY that overlaps an older recovery waits for a fresh snapshot rather than treating the old recovery as success. Tests reproduced and fixed this race for both an old live PTY and historical output without a live PTY.

## Native screen-first prototype

The upstream [snapshot header at 51ed437c](https://github.com/ghostty-org/ghostty/blob/51ed437c/include/ghostty/vt/snapshot.h) describes READY, history PAGE records, and FINISH. Availability was then checked against the actual pins, not inferred from that upstream example:

- Ghostty source: `22d13172cde98a0a4dda05d3d6a3fcb0dd8ed018`, from `scripts/prepare-ghostty-vt.mjs`.
- Rust bindings: `de9fd9b0fa4ab53faebd3d489f4c74fe0ec832ec`, version 0.2.1, from `src-tauri/Cargo.toml`.
- Native declarations include `ghostty_snapshot_decoder_ready()` and `ghostty_snapshot_decoder_next()`.
- The pinned safe wrapper exposes `snapshot::Decoder::ready()`, `IncrementalDecoder::next()`, `terminal_mut()`, and `into_terminal()` in [snapshot.rs](https://github.com/Uzaaft/libghostty-rs/blob/de9fd9b0fa4ab53faebd3d489f4c74fe0ec832ec/crates/libghostty-vt/src/snapshot.rs).

The standalone crate in `native/` compiles and calls those safe APIs. It parses the identical browser fixture, encodes a binary snapshot, restores READY, verifies the final-screen marker, then incrementally restores history through FINISH. Each finished screen is compared with the original. Its separate Cargo workspace does not change application dependencies or lockfiles.

At 132-by-22 cells and the production 8 MiB Ghostty history limit, the snapshot was 5,107,786 bytes. Five release-build trials measured:

| Native measurement | Result |
| --- | ---: |
| File read, JSON and base64 decode, once | 21.24 ms |
| Initial VT parse, once | 135.64 ms |
| Snapshot encode, once | 4.52 ms |
| READY median | 0.148 ms |
| FINISH median, including READY screen formatting | 6.207 ms |
| Complete one-shot decode median | 6.029 ms |
| Maximum single history-page decode | 0.373 ms |
| History pages / prepended rows | 18 / 6480 |
| Whole-probe maximum RSS | 207,257,600 bytes |
| Whole-probe peak memory footprint | 201,704,000 bytes |

See [raw native trials](evidence/native-report.json) and [native memory evidence](evidence/native-memory.txt). Native timings start with the complete binary snapshot already in memory. They do not include a streamed transport, IPC scheduling, xterm parsing, or painting. The native and browser inputs match, but their retained-history policies differ: Ghostty is bounded by bytes, xterm by 10,000 scrollback rows. No frontend acceleration ratio can be derived from these numbers.

### Why the frontend blocks shipping

The installed xterm 6.0.0 public types in `node_modules/@xterm/xterm/typings/xterm.d.ts` expose `IBuffer` positions and length as readonly. `getLine()` and `getCell()` inspect cells; they do not insert rows. The public Terminal API has writes, scrolling, resizing, clearing and resetting, but no history-prepend operation. `IBufferElementProvider` provides DOM content, not mutable terminal rows or parser state.

Ghostty's `next()` prepends into its own terminal, not into xterm. Feeding those older pages to `write()` would execute them after newer live output, modifying the cursor, active screen, images and parser state. Replaying the entire history into a second xterm and swapping it would still require a live-output barrier, image transfer, scroll-anchor preservation and extra memory. It is not incremental history prepend and was not implemented or claimed as such.

Consequently, frontend READY-to-usable-screen and incremental-history-completion timings are **unavailable** for a correct screen-first implementation. The blocker is explicit rather than hidden behind a fast screen-only demo that loses history.

A future go decision requires a supported renderer contract that can append older history before the live buffer without executing VT into it, including image ownership, stable scroll anchors, reflow and generation fencing. An explicitly separate history UI could be evaluated as a different product design. Neither a private-buffer mutation nor a renderer replacement is part of this ticket.

### Experiment coverage and limits

| Case | Result |
| --- | --- |
| Live output between READY and FINISH | Native tests preserve continuation and final state. Real runtime queues live output behind replay and rejects stale-generation events. |
| PTY replacement or spawn during replay | Runtime regressions cover both; Arc verifies a generation change during actual image-bearing replay. |
| Resize/reflow during loading | Current xterm path passes. Native live screen remains usable, but after resizing the probe **skipped all 18 remaining history pages**, each reporting zero applied rows. Do not promise complete history across this operation. |
| Scrolling during loading | Native history can grow while the viewport stays detached from the live bottom. Current concealed xterm ignores trusted wheel input while inert; scrollback is reachable after reveal. Exact native scroll-anchor content across prepends is not established. |
| Images | Identical native input includes image escapes, but native VT formatting does not verify image pixels. Arc verifies a 40-by-40 supported inline image after restoration in WebGL and fallback. Incremental cross-renderer image transfer remains unsupported. |
| Alternate screen and parser continuation | Native probes cover split CSI, split UTF-8 and return to the primary screen. Real xterm integration tests cover CSI, UTF-8, queries and images; Arc checks alternate-screen return and continued red text. |
| Cancellation and truncation | Native `into_terminal()` abandons decoding while keeping live writes usable. Truncated FINISH is rejected. View tests and Arc cover cancelled/superseded restoration. |
| Hide, detach, reopen, failure, retry and disposal | Adapter tests cover stale callbacks, delayed mounting, hidden completion, failure/retry and disposal. Real runtime reopening obtains fresh authority. |
| WebGL unavailable or lost | Both pass with real rendering. Context loss is forced while a snapshot is restoring. |

## Run it

Use an existing Arc debugging session. The scripts open and close only their own tabs. They never start another browser or close Arc. The small CDP client avoids attaching to unrelated suspended Arc tabs, which caused Playwright's browser-wide CDP attachment to time out during setup.

```sh
pnpm i
pnpm exec vite --config packages/terminal-runtime/conformance/vite.config.ts --port 5199
# In another terminal:
node scripts/experiments/terminal-restoration/run.mjs artifacts/terminal-restoration/current-webgl
node scripts/experiments/terminal-restoration/run.mjs artifacts/terminal-restoration/current-fallback --fallback
node scripts/experiments/terminal-restoration/verify.mjs
node scripts/experiments/terminal-restoration/verify.mjs --fallback
```

`ARC_CDP_URL` defaults to `http://127.0.0.1:9222`; `RESTORATION_URL` defaults to `http://127.0.0.1:5199`. To reproduce the old baseline, copy this experiment directory into a separate worktree at the baseline commit, install there, and run its Vite server and `run.mjs` there. Do not replace the renderer in a worktree being used for implementation.

Prepare the existing pinned native source with `pnpm ghostty:prepare` if it is not already cached. Use the paths printed by that command:

```sh
export GHOSTTY_SOURCE_DIR="$HOME/.cache/openforge/ghostty/22d13172cde98a0a4dda05d3d6a3fcb0dd8ed018"
export GHOSTTY_ZIG_SYSTEM_DIR="$HOME/.cache/openforge/ghostty/zig-system-22d13172cde98a0a4dda05d3d6a3fcb0dd8ed018"
manifest=scripts/experiments/terminal-restoration/native/Cargo.toml
cargo test --release --locked --offline --manifest-path "$manifest" -- --nocapture
cargo build --release --locked --offline --manifest-path "$manifest"
/usr/bin/time -l scripts/experiments/terminal-restoration/native/target/release/terminal-restoration-probe \
  artifacts/terminal-restoration/current-webgl/fixture.json 132 22
```

## Validation

Chosen scope: full Terminal Runtime package, affected host/terminal-plugin contracts, and the standalone Rust experiment. No production Rust or IPC payload changed.

- Full Terminal Runtime suite and its `build` type check.
- Root TypeScript and plugin-host type checks.
- Host terminal tests and conformance helper tests, including terminal session-service boundaries and the terminal plugin.
- Desktop generated IPC contract check.
- The normally opt-in profiler-off benchmark, separately enabled and passed.
- Native debug and release tests, release build, `cargo check`, all-targets Clippy with warnings denied, and formatting check.
- Both conformance surfaces at DPR 1 and 2 in Arc, plus real runtime restoration, image pixels, scrolling, resizing, cancellation, generation replacement and both WebGL fallback paths.

The latest counts and commands are in [measurements](evidence/measurements.json) and [validation commands](evidence/validation.json).

CI follow-up: the concurrent lifecycle visual check exposed a completed terminal staying concealed after hide/remount without another snapshot. The adapter now preserves completed state across hiding while still cancelling unfinished work. The unchanged 24-cycle conformance scenario passed in Arc with zero differing pixels after this fix. All package, host, static, native and 31-per-renderer Arc checks passed again. The opt-in profiler benchmark initially measured 3.125% overhead against its 2% limit, then passed on one isolated retry; that variability is not evidence of a concealment performance change.

Not run: the stock runner's pinned Chromium golden-image comparisons and IME interaction, the full Electron/preload/sidecar/real-PTY performance scenario, and repository-wide/backend Rust suites. The Arc checks are real browser rendering but do not claim full desktop end-to-end coverage. Native per-tab RSS and a correct frontend incremental-history benchmark remain unavailable for the reasons above.

## Separate cleanup

Created `KVG-5201`, dependent on KVG-5199, for existing live-write presentation accounting. `xtermPresentation.ts` assigns the current enqueue generation in `onWriteParsed`, although xterm documents that this event can fire with writes still pending. Snapshot concealment waits for each snapshot write callback separately. The broader live-write accounting issue was not folded into this change.
