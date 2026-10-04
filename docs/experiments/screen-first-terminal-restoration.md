# Screen-first terminal restoration feasibility

Task: KVG-5198. Decision: **no-go for incremental history in the current xterm view**. Ghostty's native incremental decoder is available and works with our pins. It does not supply the missing frontend history operation.

## Scope and evidence ownership

KVG-5199 consolidated this experiment with the concealment fix from KVG-5196. Its completed [experiment, runnable probes and evidence](../../scripts/experiments/terminal-restoration/README.md) already cover the requested bounded investigation. This report reuses those measurements rather than repeating or claiming a second implementation. The last change to the experiment directory is `df6cd3be6dca6e53e533c12b66083e16ea7d3768`; its evidence subdirectory last changed at `96deb9c1815170bb727cca2da499e00d413cf294`.

For the initial KVG-5198 reconciliation, the native probes and Terminal Runtime checks were rerun at `855d845547eaeb8e7625599b15d1a308883ba70a`. See [validation and evidence provenance](screen-first-terminal-restoration-validation.json). That phase changed only documentation. The subsequently approved [full-native contract experiment](native-ghostty-screen-first-contract.md) adds isolated compile probes and current-upstream evidence. No production source, dependency, lockfile, renderer or transport protocol changed.

A further approved [native-owner fork experiment](native-ghostty-host-snapshot-fork.md) now tests host-owned I/O and snapshot adoption inside Ghostty's native `Termio`. It supplies headless state evidence, not a frontend incremental-history implementation or a production renderer replacement.

The later [native window experiment](native-ghostty-window.md) exposes the same owner through local Surface/C API operations and an AppKit fixture window with runtime-compiled Metal shaders. Native state and lifecycle checks pass; pixel verification is still blocked by screenshot permission. It does not attach an existing OpenForge session or change production.

## Availability and compatibility

| Layer | Verified contract |
| --- | --- |
| Requested [Ghostty header at 51ed437c](https://github.com/ghostty-org/ghostty/blob/51ed437c/include/ghostty/vt/snapshot.h) | READY follows terminal state, active screens and parser continuation. History pages follow newest to oldest. FINISH terminates the stream. |
| Actual [Ghostty pin 22d13172](https://github.com/ghostty-org/ghostty/blob/22d13172cde98a0a4dda05d3d6a3fcb0dd8ed018/include/ghostty/vt/snapshot.h) | Exports `ghostty_snapshot_decoder_ready()` and `ghostty_snapshot_decoder_next()`. Record CRC32C plus BLAKE3 checkpoints bind ordering and completeness. Snapshot version 1 explicitly has no binary-compatibility guarantee. Do not infer wire compatibility from the earlier header. |
| [libghostty-rs de9fd9b0, version 0.2.1](https://github.com/Uzaaft/libghostty-rs/blob/de9fd9b0fa4ab53faebd3d489f4c74fe0ec832ec/crates/libghostty-vt/src/snapshot.rs) | Safe `Decoder::ready()`, `IncrementalDecoder::next()`, `terminal_mut()` and `into_terminal()` are present. The rebuilt test executable links both native symbols. No upgrade is needed to experiment. |
| xterm 6.0.0 | `Terminal.write()` parses VT into the current terminal. `IBuffer` positions and length are readonly; `getLine()` and `getCell()` inspect state. No public buffer import or history-prepend operation exists. See installed `node_modules/@xterm/xterm/typings/xterm.d.ts`, `Terminal`, `IBuffer` and `IBufferLine`. |

The decoder's contract has limits that matter to a transport design:

- READY returns usable Ghostty state, not xterm state or evidence of a painted frame. Some resident history can already precede the active area at READY.
- Each successful `next()` consumes one history page. Progress can report **zero applied rows** when the page is no longer safe to attach. FINISH validates consumed input, not that every original history row survived concurrent changes.
- Reads are synchronous. A successful zero-byte read means permanent EOF, not temporary network starvation. Returning an I/O error does not provide a resumable pause. Stage sufficient data outside the decoder or block a dedicated worker, never the renderer/UI thread or the live-output actor.
- A decoding error invalidates the decoder's source position. Drop it; do not retry `next()`. The already-restored terminal remains usable. `into_terminal()` also permits deliberate cancellation before FINISH.
- Restored parser state may be unfinished, but continuation tracking starts disabled. Reapply OpenForge's 256 KiB tracking policy before taking another checkpoint. The decoder's acceptance limit and runtime tracking policy are different settings.
- Native snapshot integrity is not PTY identity or authorization. Shell Session Key, PTY instance, attachment generation and output watermark remain OpenForge responsibilities.

## Why Ghostty READY does not make xterm screen-first

The [current production path](../terminal-state-and-response-paths.md) captures portable VT, a bounded compatibility replay and parser continuation at one output watermark. The view applies compatibility replay, byte-oriented CAN, portable VT, then continuation. Later contiguous live frames follow that watermark. Concealment hides intermediate paints; it does not remove any fetch, decode or parse work.

Ghostty's decoder prepends into its own page storage. It does not return instructions that can prepend into xterm without changing the active parser and screen.

| Candidate | Finding |
| --- | --- |
| Write older VT after showing READY | Reject. The bytes execute after newer live bytes, changing the cursor, modes, screen and possibly unfinished parser state. This is replay, not prepend. |
| Mutate xterm private buffers | Reject. No supported contract covers reflow, markers, selection, image ownership or parser synchronization. Prohibited by this experiment. |
| Build a hidden second xterm, then swap | Not a safe shortcut. It still replays history and needs a live-output barrier, bounded catch-up, image reconstruction, scroll-anchor/selection transfer and cancellation fencing. It can replace newer output and increases memory. Not implemented. |
| Show the live screen and discard older history | Faster by reducing functionality. Does not meet the task. |
| Separate read-only history viewer | Possible future product design, not equivalent terminal scrollback. Requires explicit decisions about selection, search, links, images, reflow and where the history/live boundary appears. Not implemented. |
| Supported renderer history import | The missing capability. Requires either a public xterm contract or a separately approved renderer evaluation. No renderer replacement ships here. |

Portable VT does not transfer xterm image-addon storage. Today's compatibility replay is capped at the newest 256 KiB and cannot promise images from arbitrary older history. Existing image-pixel checks prove the supported replay case, not cross-renderer image migration or complete historical-image retention.

## Benchmark evidence

All numbers below are **reused KVG-5199 observations**, not fresh KVG-5198 performance measurements. The input is identical across those runs: 30,000 ANSI-colored lines, 60 image escapes, 28,401,599 bytes, SHA-256 `fb86424b2d0f69145af29606307336e582776d45085ea7b4c48d48001ef12c53`. The fixture ends with a known screen marker. Arc used Chromium 153.0.8010.53 on Apple M5 macOS ARM64, DPR 1.

### Frontend restoration path

[Raw summary](../../scripts/experiments/terminal-restoration/evidence/measurements.json), [runner](../../scripts/experiments/terminal-restoration/run.mjs), [before image](../../scripts/experiments/terminal-restoration/evidence/baseline-history.png), [completed image](../../scripts/experiments/terminal-restoration/evidence/completed-screen.png).

All timings are milliseconds. These runs invoke the real `TerminalView.replaceSnapshot()` and presentation drain, but fetch a synthetic local HTTP JSON fixture and pass `ptyInstanceId: null`. They do not time production IPC, Ghostty portable formatting, the live-session compatibility payload or a real PTY. Browser base64 decoding and native Ghostty snapshot decoding are different measurements.

| Renderer/path | Fetch + JSON | Base64 decode | Parse | History parsed | First correct usable screen | Largest replay rAF gap | JS heap before → after, MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGL, pre-concealment | 107.8 | 820.3 | 395.1 | 1323.2 | 1334.5 | 26.0 | 7.76 → 250.52 |
| WebGL, concealed trial 1 | 94.6 | 969.4 | 1020.7 | 2084.7 | 2090.8 | 47.7 | 7.54 → 264.39 |
| WebGL, concealed trial 2 | 65.2 | 819.5 | 362.1 | 1246.8 | 1256.4 | 29.5 | 7.78 → 270.95 |
| Fallback, pre-concealment | 65.5 | 823.8 | 838.2 | 1727.5 | 1738.4 | 13.2 | 7.21 → 80.92 |
| Fallback, concealed trial 1 | 66.3 | 909.7 | 718.6 | 1694.6 | 1708.9 | 13.5 | 7.24 → 65.44 |
| Fallback, concealed trial 2 | 62.2 | 842.9 | 672.7 | 1577.8 | 1587.1 | 15.3 | 7.23 → 62.13 |

WebGL used 132×22 cells; fallback used 118×22. Compare only within the same renderer/geometry. Concealment reduced visible historical samples from 58/131 to zero, but the timings do not establish a speedup. The slow trial is retained.

rAF sampling starts **after decoding**, so it excludes the roughly 0.8 to 1.0 second synchronous base64 stall. Heap endpoints are not peak allocations, isolated RSS or GPU memory. Usable-screen timing includes presentation readiness, not hardware input-to-photon latency. A shared desktop and two concealed trials cannot establish p95 responsiveness.

### Native bounded prototype

The existing [standalone crate](../../scripts/experiments/terminal-restoration/native/src/main.rs) consumes the same fixture with the production 8 MiB Ghostty history cap. At 132×22 it produces a 5,107,786-byte snapshot. [Five release trials](../../scripts/experiments/terminal-restoration/evidence/native-report.json) report:

| Measurement | Result |
| --- | ---: |
| File read + JSON + base64 decode, once | 21.24 ms |
| Initial VT parse, once | 135.64 ms |
| Snapshot encode, once | 4.52 ms |
| READY median | 0.148 ms |
| FINISH median, including READY screen formatting | 6.207 ms |
| One-shot decode median | 6.029 ms |
| Maximum history-page decode | 0.373 ms |
| Pages / rows prepended without resize | 18 / 6480 |
| Whole-probe maximum RSS | 207,257,600 bytes |
| Whole-probe peak memory footprint | 201,704,000 bytes |

[Native memory evidence](../../scripts/experiments/terminal-restoration/evidence/native-memory.txt) covers the whole process, including file loading, JSON/base64 decoding and both snapshot-decoding modes. READY/FINISH start with the complete snapshot already in memory; they do not measure streamed fetch, transport backpressure, browser parsing or pixels. The native 8 MiB cap and xterm's 10,000-row cap retain different histories despite identical input. There is no valid native-to-browser speedup ratio.

**A correct frontend incremental-history benchmark remains unavailable.** Reporting 0.148 ms as time to a usable OpenForge terminal would be false. The bounded prototype establishes native feasibility; the xterm API audit establishes the frontend blocker.

## Compatibility matrix

The existing [native probes](../../scripts/experiments/terminal-restoration/native/src/probes.rs), [browser verification script](../../scripts/experiments/terminal-restoration/verify.mjs) and [WebGL](../../scripts/experiments/terminal-restoration/evidence/verification-webgl.json)/[fallback](../../scripts/experiments/terminal-restoration/evidence/verification-fallback.json) results provide the following coverage. Browser evidence is from KVG-5199, not rerun here.

| Case | Evidence and limit |
| --- | --- |
| Concurrent live output | Native continuation/live writes between READY and FINISH preserve the compared formatted screen. Existing runtime/browser probes queue live frames behind replay and reject stale frames. This does not demonstrate xterm history prepend. |
| Resize/reflow | KVG-5198 rerun again consumed all 18 remaining pages with zero rows applied after resize. The current screen stayed usable. Complete older-history recovery across resize is not proven and cannot be promised. |
| Scrolling during load | Native tests retain a viewport detached from the live bottom while row count grows. They do not verify exact anchored row content across prepends. Current xterm is inert during concealed replay; scrollback works after reveal. |
| Alternate screens | Native probe returns from the alternate screen while continuing decode and compares the result. Browser probes cover alternate-screen return. Cross-renderer import of both buffers remains unsupported. |
| Inline images | Existing browser checks verify a supported 40×40 image after replay with WebGL and fallback. Native text/VT comparisons do not verify image pixels. Older-image import is unresolved. |
| Parser continuation | Native cases cover split CSI, split UTF-8 and alternate-screen transitions. Current renderer tests cover continuation after compatibility replay. Every split point and partial image/control-string payload is not exhaustively covered. |
| Detach/reopen | Existing runtime/browser probes obtain fresh authority on reopen; they do not reuse a cancelled restoration as current state. No incremental frontend lifecycle exists to validate. |
| Cancellation/truncation | Fresh native tests confirm cancellation retains a usable terminal and truncated FINISH is rejected. View tests cover replacement/disposal and stale completion callbacks. Reader starvation/corruption fault injection is not part of the bounded native suite. |
| Stale PTY generations | Existing runtime/browser checks replace the PTY during replay and reject stale events. Native Ghostty has no OpenForge generation identity; an eventual page transport must carry it. |
| Renderer fallback | Existing browser evidence covers unavailable WebGL and context loss during restoration. No new renderer was tested. |

Initial reconciliation validation passed 5 native probes, 300 runtime tests and the runtime type check. One opt-in profiler benchmark was skipped. That phase's diff was documentation/evidence only. Browser performance, golden-image comparisons, IME, production Electron/IPC/real-PTY performance, full backend tests, and per-phase RSS were not rerun. Earlier results are attributed rather than relabeled as current passes. Validation of the later isolated full-native compile probes is recorded in the [contract experiment](native-ghostty-screen-first-contract.md).

## Recommended architecture and decision gates

Keep Ghostty authoritative and keep the concealed, watermark-ordered xterm restoration path for now. If startup work continues, measure real portable-snapshot payloads and decoding first; the synthetic base64 stall is an investigation lead, not proof of production impact.

Before another screen-first implementation, choose between a supported single-terminal history-import API and an explicitly separate read-only history product. Do not build a temporary second renderer or splice private buffers while waiting for that decision.

A future single-terminal design needs:

1. A frozen snapshot identity bound to Shell Session Key, PTY instance, attachment generation, geometry epoch and output watermark. Subscribe before capture. Publish only contiguous later output; recover sequence gaps from authority.
2. Separate live-screen and immutable history operations. History must never execute VT against the live parser or overwrite newer output. Pages need stable logical row identities, ordering, bounded storage and image ownership. Prepend must preserve scroll anchors, selection and alternate-buffer identity.
3. A cancellable page worker with bounded fetch/decode queues. Respect synchronous decoder reads. Free the decoder and source on cancellation or failure without terminating the live terminal. Old-generation completion must be harmless.
4. An explicit resize policy. The current zero-row behavior requires either a safe history rebase/refetch or an accepted incomplete-history UX. Never label FINISH alone as full history completion.
5. A renderer-visible completion boundary and end-to-end responsiveness measurements that include fetch and base64/native decoding, not just replay rAF samples. Correct usable screen means correct cursor/modes/continuation, accepted user input and no later history-driven replacement.

Go only when the public renderer contract exists and the entire matrix passes with ordered history, supported image pixels, stable scroll anchors and no dropped/duplicated/newer-output replacement. Validate both renderers and real PTY/IPC integration. Any private mutation, silent history loss, stale-generation mutation or unsupported image transfer is a hard no-go.

Proposed performance gates for a future experiment, subject to owner approval: at least 20 interleaved trials per renderer on identical geometry, payload, retained-history cap and hardware; at least 30% lower p95 first-correct-usable-screen time; no more than 20% regression in p95 total history completion; no loading-induced main-thread task over 50 ms; and no more than 25% increase in isolated peak process memory, with no retained growth across 20 cancel/reopen cycles. Record raw samples, live-input delay, process/GPU-memory gaps and cold/warm conditions. The existing data is insufficient to pass these gates.

## Follow-up

Created **KVG-5214**, dependent on KVG-5198, to correct contradictory terminal ADR supersession guidance without changing historical decisions or runtime behavior. Existing **KVG-5201** already covers live-write presentation accounting; no duplicate task was created. No production renderer or dependency-upgrade task was started.
