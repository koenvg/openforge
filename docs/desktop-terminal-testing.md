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

## Interpreting results

`driverToPaintedEcho` measures from the Playwright driver's text input action until `TerminalView.drainPresentation()` confirms a renderer-visible frame containing the unique marker. It includes automation transport, PTY, model, renderer, and compositor work; it is not raw keyboard hardware latency.

The report excludes configured warm-up samples and records the median and nearest-rank p95. PTY throughput stops only after expected bytes, sequence continuity, the completion marker, and presentation drain evidence all agree.

Compare results only when the operating system, architecture, CPU, Electron and Chromium versions, app revision, renderer, device-pixel ratio, and terminal geometry are equivalent. Native app, renderer, GPU, and complete process-tree RSS are separate from JavaScript heap. Unsupported memory values are reported as unavailable, never as zero.
