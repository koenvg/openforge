# Terminal renderer presentation harness

This harness tests what a Terminal Surface presents after `TerminalView` has parsed and painted output. It does not test VT parsing or the Terminal Model again. The input recordings come from the KVG-3903 corpus at `../fixtures/terminal-model-recordings.v1.json`; the Rust Terminal Model chunking test reads the same file.

The current renderer is xterm. A native libghostty renderer can join the matrix by registering a `TerminalConformanceRenderer` in `src/rendererRegistry.ts`. Scenarios, assertions, benchmark code, reports, and baselines depend on `TerminalView`, not xterm types. The harness has no wterm dependency.

## Run it

```sh
pnpm terminal:presentation
```

The command writes screenshots and `report.json` to `artifacts/terminal-presentation`. Choose another output directory with `--output=path`. Select a registered renderer with `--renderer=id`.

Create or refresh baselines on a machine approved for that platform:

```sh
pnpm terminal:presentation:update
```

Baselines live under `baselines/<os>-<arch>/<renderer>`. Review changed PNG files before committing them. A platform without checked-in baselines still runs all semantic and interaction checks. Its report marks screenshots `unbaselined` instead of treating another platform's raster output as authoritative.

## CI

The `terminal-presentation` CI job installs Chromium, runs `pnpm terminal:presentation` on Ubuntu, and uploads the report and screenshots. Linux currently has no checked-in pixel baseline, so CI enforces semantic results, interactions, compositor drain evidence, and the blank-terminal rejection. Add reviewed Linux baselines to enable bounded pixel diffs there as well.

## What it checks

The semantic matrix runs through both an Agent Terminal and a Terminal plugin shell. It covers:

- ANSI palette, indexed color, truecolor, bold, italic, and underline
- block drawing, Powerline separators, Nerd Font and PUA glyphs, and ligature samples
- CJK width, combining marks, emoji, ZWJ families, flags, and keycaps
- cursor presentation, OSC 8 links, and alternate-screen state
- resize and reflow, detach and reattach, and reconnect bootstrap
- device-pixel ratios 1 and 2, with dark and light themes
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
