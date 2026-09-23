# Terminal renderer presentation harness

This harness tests what a Terminal Surface presents after `TerminalView` has parsed and painted output. It does not test VT parsing or the Terminal Model again. The input recordings come from the KVG-3903 corpus at `../fixtures/terminal-model-recordings.v1.json`; the Rust Terminal Model chunking test reads the same file.

The current renderer is xterm. A native libghostty renderer can join the matrix by registering a `TerminalConformanceRenderer` in `src/rendererRegistry.ts`. Scenarios, assertions, benchmark code, reports, and baselines depend on `TerminalView`, not xterm types. The harness has no wterm dependency.

## Run it

Run the canonical terminal and Markdown browser checks in the same pinned ARM64 Linux container as CI:

```sh
pnpm terminal:visual:check
```

Create or refresh the canonical Linux baselines from an Apple Silicon development host with:

```sh
pnpm terminal:visual:update
```

These commands also own Markdown visual checking and updates; `pnpm markdown:visual` and `pnpm markdown:visual:update` route through the same container. Review every changed PNG before committing it.

For a native host diagnostic that also invokes the live PTY colour-profile assertion, run `pnpm terminal:presentation`. It uses `baselines/<os>-<arch>/<renderer>` and writes screenshots and `report.json` to `artifacts/terminal-presentation`. Choose another output directory with `--output=path` or a registered renderer with `--renderer=id`. `pnpm terminal:presentation:update` refreshes only that host-specific diagnostic baseline; it does not update the canonical CI images.

## CI

The `terminal-presentation` CI job runs `pnpm terminal:visual:check` on `ubuntu-24.04-arm`. The command uses the digest-pinned Playwright Ubuntu Noble image and the reviewed `linux-arm64/xterm` terminal and Linux Markdown baselines. Bounded pixel differences fail alongside semantic, interaction, compositor-drain, and blank-terminal checks. The native PTY assertion remains in the macOS Rust suite and is intentionally omitted from this browser-only Linux job.

## What it checks

The semantic matrix runs through both an Agent Terminal and a Terminal plugin shell. It covers:

- ANSI palette, indexed color, truecolor, bold, italic, and underline
- block drawing, Powerline separators, Nerd Font and PUA glyphs, and ligature samples
- CJK width, combining marks, emoji, ZWJ families, flags, and keycaps
- cursor presentation, OSC 8 links, and alternate-screen state
- resize and reflow, detach and reattach, and reconnect bootstrap
- device-pixel ratios 1 and 2, with dark and light themes
- renderer filtering for a Codex-shaped batch of foreground, background, cursor, and 16 ANSI colour queries, plus live palette switching and snapshot recovery
- native replies to that 19-query batch through a live PTY across light, dark, and contributed profiles, with the same PTY identity before and after recovery
- keyboard, SGR mouse input, selection, and Chromium IME composition

`TerminalView.capturePresentation()` supplies deterministic, renderer-neutral rows and cells. Text, cell widths, styles, buffer choice, and selection are asserted as data. `TerminalView.drainPresentation()` resolves only after queued writes parse, xterm reports a renderer frame, and two browser animation frames let the compositor present it. Throughput, first interaction, recovery, and screenshot timings all stop at that drain evidence rather than at `writeLive()` enqueue.

## Visual bounds

The checked-in matrix has twelve screenshots: six presentation recordings for the Agent Terminal at dark/DPR 1, and the same six for the plugin shell at light/DPR 1. `pixelmatch` uses a per-pixel threshold of `0.15`; at most `1%` of pixels may differ. Each screenshot also has a renderer-content check that rejects a blank terminal even when a bad blank baseline exists. A failure writes the actual image and a diff image to the artifact directory.

The semantic matrix separately runs both surfaces and themes at DPR 2. Headless Chromium can omit WebGL framebuffer pixels from screenshots taken with an emulated DPR, so checked-in WebGL pixel baselines use DPR 1. DPR 2 still requires matching cells, write and parse generations, and renderer-frame drain evidence.

Font hinting, antialiasing, color management, GPU drivers, and WebGL fallbacks differ by operating system and architecture. Keep separate baselines for each `<os>-<arch>/<renderer>` directory. Do not widen the pixel ratio to hide a platform-wide shift. Add a reviewed platform baseline or fix the rendering setup.

## Memory and timing

The JSON report separates these values:

- browser root process RSS
- renderer process RSS
- GPU process RSS
- complete Chromium process-tree RSS
- JavaScript heap used, recorded only as a component

RSS comes from the native process table while a populated terminal page is alive. Windows and restricted process environments may report memory as unavailable. The harness never labels JavaScript heap as total renderer memory.

Timing values are local benchmark evidence, not universal performance budgets. Compare runs on the same hardware, browser build, renderer, theme, and DPR. The report retains the presentation generation, parsed generation, render frame, rendered row range, renderer id, DPR, and geometry for each measured drain.
