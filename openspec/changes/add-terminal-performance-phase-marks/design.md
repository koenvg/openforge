## Context

See `proposal.md` for motivation and `specs/desktop-test-environment/spec.md` for required behavior.

The full-app scenario currently starts a Node `performance.now()` timer before bridge verification, drives the visible application to Shell 1, sends a readiness marker, and stops after the terminal probe drains presentation. This produces the useful end-to-end number but does not expose internal phase boundaries.

The renderer already has stable observation points in the terminal controller, attachment controller, terminal transport subscription, terminal state view, xterm view, and presentation controller. The presentation controller uses xterm write-parse and render callbacks plus two animation frames. These points can emit passive marks without adding waits.

Terminal attachment and initial sizing intentionally complete before the shell spawn request. Existing tests enforce this because PTY creation needs the fitted rows and columns. The phase model must describe this order rather than changing it.

## Goals / Non-Goals

**Goals:**

- Keep all phase timestamps in one renderer monotonic clock domain.
- Make phase names and ordering a small typed contract shared by the runtime observer, test probe, scenario, and report builder.
- Distinguish desktop navigation, terminal setup, backend spawn completion, input delivery, model routing, xterm parsing, rendering, and presentation.
- Keep focused echo samples free of repeated tab-click work while preserving one full-driver measurement.
- Make missing and out-of-order marks diagnosable in failed reports.
- Avoid clock reads and retained trace data when profiling is inactive.

**Non-Goals:**

- Change terminal attachment, spawn, output, parse, render, or presentation scheduling.
- Add Rust-side timestamps or synchronize clocks between Node, Chromium, and the sidecar.
- Change PTY IPC payloads or return types.
- Set shell startup or echo latency budgets.
- Optimize shell startup in this change.

## Decisions

### 1. Use an opt-in renderer trace recorder

Add a narrow performance observer contract to Terminal Runtime. A development desktop-test session can supply a recorder; normal application sessions supply nothing. Every mark site checks for an observer before reading `performance.now()`.

The development-only terminal test probe will own trace control and serialized retrieval. The driver starts a shell-readiness trace before opening the seeded task. When the runtime creates the terminal entry, later marks bind to the terminal key. The probe exposes phase data, not the recorder, runtime entry, transport, or xterm instance.

```text
Playwright driver
      |
      | start trace / read result
      v
terminal test probe ------> renderer trace recorder
                                  ^
                                  |
             terminal lifecycle and xterm callbacks
```

A trace records the first applicable timestamp for each phase. Output-related phases remain disarmed until `inputAcceptance`, preventing prompt output that arrived before the readiness command from becoming that command's `firstOutput`.

Alternative considered: use global `performance.mark()` entries and inspect the browser performance timeline. That makes ownership and cleanup harder, allows unrelated terminals to collide, and retains global entries outside the test probe contract.

### 2. Define phases at existing callback boundaries

The phase contract and observation points are:

| Phase | Observation point |
|---|---|
| `lifecycleStart` | The probe starts the renderer trace before desktop navigation |
| `terminalAttachment` | Terminal attachment begins, before mounting the view |
| `xtermMount` | The xterm view completes its first `terminal.open()` |
| `shellSpawnRequest` | The task terminal controller is about to call the shell-spawn adapter |
| `ptyCreation` | The shell-spawn promise returns the PTY instance ID |
| `inputAcceptance` | The terminal view emits accepted user input before the transport write |
| `firstOutput` | The first model-output subscription callback after input acceptance |
| `modelPublication` | The active terminal state routes that output into `view.writeLive()` |
| `xtermParse` | xterm invokes `onWriteParsed` for the traced write generation |
| `renderCallback` | xterm invokes `onRender` after that parse |
| `presentationProof` | The drain resolves after its renderer frame and two animation frames |

The recorder keeps enough generation or trace state to reject stale callbacks from earlier writes and old terminal instances. Marks do not create promises, animation frames, timers, or transport operations.

`ptyCreation` is deliberately renderer-observed completion. The interval from `shellSpawnRequest` to `ptyCreation` covers the existing Rust spawn command while keeping both timestamps on the renderer clock.

Alternative considered: add sidecar timestamps to PTY and model-output payloads. Rust and Chromium monotonic clocks have unrelated origins, so cross-process subtraction would require clock synchronization and an IPC contract change without improving the requested local phase report.

### 3. Preserve actual lifecycle order

The declared order is:

```text
lifecycleStart
  -> terminalAttachment
  -> xtermMount
  -> shellSpawnRequest
  -> ptyCreation
  -> inputAcceptance
  -> firstOutput
  -> modelPublication
  -> xtermParse
  -> renderCallback
  -> presentationProof
```

The report builder validates finite non-negative timestamps and this ordering. A missing mark remains present with `timestampMs: null`. A segment is available only when both endpoint marks exist and are ordered. Missing or reversed endpoints produce `durationMs: null` and a correctness diagnostic, never zero.

Alternative considered: order phases as they appeared in the initial request, with spawn before attachment. That contradicts the current attach-before-spawn sizing invariant and would either generate false ordering failures or force instrumentation to change runtime behavior.

### 4. Extend the report without replacing the end-to-end metric

Bump the terminal performance report schema version and add a phase timeline under the existing shell-readiness metric. The shape contains a clock-domain identifier, an ordered mark array, and an ordered segment array. Each segment names its endpoints, availability, duration, and unit.

The current Node-measured `shellReady.durationMs` remains unchanged. Renderer phase segments are separate evidence because the initial driver call and renderer trace start cross a Playwright boundary. The console summary prints the end-to-end value followed by each available or unavailable segment.

The focused echo summary keeps the existing `driverToPaintedEcho` key for report consumers and adds `mode: "already-focused"`. A new `fullDriverToPaintedEcho` metric records the single focus-and-type sample. The full-driver sample is excluded from focused warm-up samples, median, and p95.

Alternative considered: replace the current shell-readiness number with the sum of renderer segments. That would change the metric boundary and hide Playwright and driver overhead that the existing number intentionally includes.

### 5. Split focus-and-type from already-focused typing

Expose driver operations for focusing Shell 1 and typing into an already-focused terminal. The existing focus-and-type operation remains the full-driver path.

The scenario records one full-driver echo command with a unique marker. It then focuses once before warm-up and runs every focused warm-up and measured sample through the already-focused operation. Both paths call the same measurement and correctness helper, so they require identical completion-marker, sequence, byte-count, and presentation evidence.

Alternative considered: pass a boolean such as `skipFocus` into one typing method. Separate method names make accidental use in a measured loop visible in tests and avoid an option whose safety depends on hidden focus state.

### 6. Verify inactive overhead with an in-process A/B benchmark

Add a terminal-runtime benchmark that alternates warmed trials of the same deterministic output workload in two configurations:

- No performance observer installed.
- A test observer installed but with no active trace.

The inactive observer must not call the injected monotonic clock. The benchmark retains raw trial durations, uses medians to reduce scheduler noise, and verifies that the inactive-observer median is less than 2 percent above the no-observer median. Alternating configurations avoids measuring one configuration only after CPU or JIT warm-up.

A separate deterministic unit test injects a clock that throws if read while no trace is active. This catches regressions more reliably than the timing benchmark alone.

Alternative considered: benchmark an active recorder against no recorder. Active collection is limited to the explicit desktop test and is not the profiler-off case required by the change.

## Risks / Trade-offs

- [Prompt or stale output claims the traced output phases] -> Arm output phases only after input acceptance and correlate parse, render, and presentation marks with the traced write generation and current PTY instance.
- [A missing callback turns into a plausible zero] -> Keep all declared marks and segments in the report with explicit availability and null durations.
- [Instrumentation changes scheduling] -> Restrict mark sites to synchronous first-write checks and forbid new waits, timers, frames, or IPC calls.
- [The 2 percent benchmark is noisy on shared machines] -> Warm both configurations, alternate trials, compare medians, retain raw data, and pair the benchmark with the deterministic no-clock-read test.
- [Report consumers assume schema version 1] -> Bump the schema version, preserve existing metric keys, and cover complete success and failure shapes in serialization tests.
- [Multiple terminals or stale instances mix traces] -> Bind traces to a terminal key and current PTY instance, and ignore callbacks after completion or replacement.

## Migration Plan

1. Add the phase contract, inactive recorder behavior, and report normalization tests without connecting production lifecycle sites.
2. Connect the development-only probe and terminal lifecycle marks while preserving attach-before-spawn behavior.
3. Connect input, output, parse, render, and presentation marks with generation and PTY-instance correlation.
4. Split the desktop driver input modes and update the scenario to record full-driver and focused echo metrics.
5. Bump the report schema, add console segment output, and update schema fixtures and documentation.
6. Run the inactive-overhead benchmark and full-app scenario before any shell startup optimization begins.

Rollback removes the optional recorder connections and new report fields, then restores schema version 1. No persisted application data or IPC migration is involved.
