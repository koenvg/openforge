# Desktop terminal testing

The desktop test harness starts the real development app with an isolated Electron profile, isolated sidecar app data, a seeded project and task, and a usable shell terminal. It never reads or writes a personal OpenForge app-data directory.

## Headed manual app

Start an interactive test app with a generated, disposable Git repository:

```bash
pnpm electron:test-app
```

The command prints the repository, run-root, and artifact paths. Close the Electron window to stop the launcher. Generated runtime data is removed after all child processes stop.

Use an existing Git repository without modifying it:

```bash
pnpm electron:test-app -- --repository=/absolute/path/to/repository
```

Keep the isolated app data, Electron profile, fixture manifest, and generated repository for investigation:

```bash
pnpm electron:test-app -- --retain --output=artifacts/desktop-test/manual
```

`--retain` applies to runtime data. Artifacts in the output directory are retained regardless.

## Automated terminal performance scenario

Run the full application path through Electron, preload, desktop IPC, the Rust sidecar, a real PTY, the terminal runtime, and the renderer:

```bash
pnpm performance:terminal:full-app
```

Choose the artifact directory, use a supplied repository, or retain runtime data with the same options:

```bash
pnpm performance:terminal:full-app -- \
  --output=artifacts/desktop-test/terminal-performance \
  --repository=/absolute/path/to/repository \
  --retain
```

The selected output directory contains:

- `report.json`: versioned measurements, correctness checks, environment metadata, fixture geometry, and artifact paths
- `terminal-performance.png`: the final successful terminal presentation
- `failure.png`: renderer state captured when launch or scenario execution fails
- `children.log`: bounded Vite, build, Electron, and sidecar output

The command fails for launch-readiness errors, missing output, incomplete PTY sequences, missing completion markers, or missing renderer presentation evidence. Timing and memory values are informational and do not fail the run by crossing an implicit budget.

### Report schema and phase timeline

Terminal performance reports use schema version 2. `metrics.shellReady.durationMs` keeps the original Node driver to presented-marker measurement. `metrics.shellReady.phaseTimeline` adds renderer timestamps and adjacent durations without replacing that end-to-end value.

All phase marks use renderer `performance.now()` and the `renderer-performance` clock-domain label. Do not subtract these timestamps from Node or Rust Sidecar monotonic timestamps. Backend work such as PTY creation is measured between renderer-observed request and completion marks.

The phase order follows the runtime's existing attach-before-spawn behavior:

1. `lifecycleStart`: the desktop test probe starts the trace before opening the seeded Task.
2. `terminalAttachment`: the Terminal View Attachment begins.
3. `xtermMount`: the first `terminal.open()` call completes.
4. `shellSpawnRequest`: the runtime is about to request a shell PTY.
5. `ptyCreation`: the shell spawn request returns its PTY instance ID.
6. `inputAcceptance`: xterm accepts the measured user input before the Terminal Transport write.
7. `firstOutput`: the first matching model-output callback arrives after input acceptance.
8. `modelPublication`: the active Terminal Session publishes that output to the Terminal View.
9. `xtermParse`: xterm parses the traced live-write generation.
10. `renderCallback`: xterm reports a render covering that generation.
11. `presentationProof`: the presentation drain resolves after its existing two-animation-frame boundary.

Each mark has `timestampMs` and `available`. Each adjacent segment has start and end phase names, `durationMs`, `unit`, and `available`. Missing marks and order violations keep the raw marks, use `null` rather than zero for unavailable durations, and add failed correctness checks.

### Echo modes

`driverToPaintedEcho` is the already-focused distribution. The scenario focuses Shell 1 once before warm-up, then sends every warm-up and measured echo through the Terminal input textbox without another tab click. Its `mode` is `already-focused`, and its median and nearest-rank p95 exclude the full-driver sample.

`fullDriverToPaintedEcho` is one separate focus-and-type sample. It clicks the visible Shell 1 tab before typing, so it keeps browser-driver focus coverage. Both modes require the same completion marker, sequence continuity, expected byte count, and presentation proof.

### Execution completion

Every measured command prints a fresh completion receipt only after the workload succeeds. The receipt uses a UUID and adjacent shell-quoted fragments, so the full receipt never appears literally in typed input. The probe's `markerMatch: 'line'` expectation requires a whole logical output line, joining soft-wrapped rows. Existing substring expectations remain available for non-command E2E fixtures.

The scenario waits for that receipt, the byte and sequence thresholds, and presentation evidence before sending another command. View recovery reuses the final executed receipt rather than issuing another command. Bulk-input byte counts include the handshake command; output thresholds include the receipt. Echo timings therefore include shell execution and receipt presentation, not just input echo.

The KVG-4638 failure with 10,610 received bytes versus 1,058,367 expected showed commands concatenated during this completion race. It is not evidence that the separately reported terminal tearing occurred.

### Profiler-off overhead

Run the alternating warmed A/B check with:

```bash
pnpm performance:terminal:profiler-off
```

The benchmark compares the same deterministic output workload with no observer and with an installed inactive observer. It prints every raw trial, both medians, the overhead percentage, and the two-percent limit. The final validation run used 50,000 iterations per trial and measured a 230.188 ms baseline median and a 228.386 ms inactive-observer median, or -0.78 percent overhead. The inactive observer also uses a throwing clock in tests, which proves disabled marks do not read the monotonic clock.

## Interpreting results

`driverToPaintedEcho` measures from the Playwright driver's already-focused text input action until `TerminalView.drainPresentation()` confirms a renderer-visible frame containing the unique marker. It includes automation transport, PTY, model, renderer, and compositor work, but excludes Shell 1 tab focus and raw keyboard hardware latency.

The report excludes configured warm-up samples and records the median and nearest-rank p95. PTY throughput stops only after expected bytes, sequence continuity, the completion marker, and presentation drain evidence all agree.

Compare results only when the operating system, architecture, CPU, Electron and Chromium versions, app revision, renderer, device-pixel ratio, and terminal geometry are equivalent. Native app, renderer, GPU, and complete process-tree RSS are separate from JavaScript heap. Unsupported memory values are reported as unavailable, never as zero.
