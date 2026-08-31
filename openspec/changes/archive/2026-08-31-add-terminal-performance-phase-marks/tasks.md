## 1. Phase contract and report normalization

- [x] 1.1 Add failing unit tests for the declared phase order, finite monotonic timestamps, adjacent segment calculation, missing values, and reversed timestamps; verify the focused report test fails for the absent phase timeline behavior.
- [x] 1.2 Implement the shared phase names, ordering, mark normalization, segment derivation, and correctness diagnostics; verify the focused report tests pass with unavailable values represented as null rather than zero.
- [x] 1.3 Add failing serialization tests for the bumped report schema, preserved `shellReady.durationMs`, renderer clock-domain metadata, ordered marks, ordered segments, and failure evidence; verify the tests fail against schema version 1.

## 2. Opt-in renderer trace recorder and test probe

- [x] 2.1 Add failing recorder tests for trace start, terminal-key binding, first-mark retention, input-armed output phases, PTY-instance replacement, generation correlation, trace completion, and stale callback rejection; verify they fail for the missing recorder.
- [x] 2.2 Implement the renderer trace recorder with an injected monotonic clock and no timers, waits, frames, or transport calls; verify recorder tests pass and duplicate or stale marks cannot overwrite accepted marks.
- [x] 2.3 Add failing terminal-probe tests for explicit development-only trace control, serializable phase retrieval, absent production and normal-development APIs, and no exposed recorder, transport, runtime entry, or xterm object; verify the focused probe tests fail before integration.
- [x] 2.4 Connect the recorder to the development desktop-test probe and terminal-runtime environment; verify focused probe tests pass and an inactive or absent trace performs no clock reads or data retention.

## 3. Terminal lifecycle phase marks

- [x] 3.1 Extend task-terminal controller and attachment tests with failing expectations for lifecycle start, terminal attachment, xterm mount, shell spawn request, and PTY creation ordering while preserving fitted dimensions before spawn; verify the focused tests fail only for missing marks.
- [x] 3.2 Add lifecycle mark calls at existing controller, attachment, and xterm mount boundaries without changing awaits or callback scheduling; verify the focused tests pass and existing attach-before-spawn tests remain unchanged.
- [x] 3.3 Add failing tests for terminal replacement and restart traces so old PTY instances cannot contribute creation or later phase marks; implement the instance binding and verify the task-terminal controller suite passes.

## 4. Input, output, parse, render, and presentation marks

- [x] 4.1 Add failing terminal-runtime tests for input acceptance, first model output after input, model publication to the active view, and rejection of prompt output received before input acceptance; verify sequencing and stale-instance cases fail for missing trace behavior.
- [x] 4.2 Connect input acceptance at the user-input callback, first output at model subscription delivery, and model publication at active `writeLive` routing; verify focused acquisition, sequencing, visibility, and transport integration tests pass.
- [x] 4.3 Add failing xterm presentation tests for traced write generation, write-parse callback, render callback, double-animation-frame presentation proof, detach failure, and stale generation rejection; verify the tests fail before phase integration.
- [x] 4.4 Connect xterm parse, render, and presentation-proof marks to the existing presentation controller without adding refreshes or animation frames; verify xterm view and presentation tests pass with the existing drain evidence unchanged.

## 5. Focused and full-driver echo modes

- [x] 5.1 Add failing desktop-driver tests for a public focus operation, an already-focused typing operation that never clicks Shell 1, and the retained focus-and-type operation; verify the focused driver test fails before the API split.
- [x] 5.2 Split focus from already-focused typing while keeping the current full-driver method; verify driver tests pass and all input still goes through the accessible Terminal input textbox.
- [x] 5.3 Add failing scenario tests that record one full-driver echo measurement, focus once before warm-up, run every warm-up and measured sample without a tab click, exclude the full-driver value from focused median and p95, and apply equivalent correctness checks to both modes.
- [x] 5.4 Update the scenario to use the shared measurement helper for both input modes and to retrieve the completed shell-readiness phase trace; verify scenario tests pass for success, missing-phase, out-of-order, missing-marker, and incomplete-sequence cases.

## 6. Full-app report and console output

- [x] 6.1 Implement schema version 2 report serialization with the phase timeline, `driverToPaintedEcho.mode` set to `already-focused`, and separate `fullDriverToPaintedEcho`; verify report serialization tests pass without removing existing metric keys.
- [x] 6.2 Add failing full-app runner tests for concise per-segment console lines, unavailable segments, preserved shell-ready output, and complete success and failure report shapes; verify the tests fail before summary changes.
- [x] 6.3 Update the full-app console summary and failure reporting to print every phase segment and retain raw marks in diagnostics; verify full-app runner tests pass and generated JSON contains no non-finite values.
- [x] 6.4 Update the desktop terminal testing documentation with phase definitions, actual attach-before-spawn order, clock-domain limits, focused versus full-driver interpretation, schema version 2 fields, and profiler overhead results; verify documented commands match `performance:terminal:full-app` and existing package scripts.

## 7. Profiler-off overhead

- [x] 7.1 Add a deterministic test with a throwing injected clock to prove that no-observer and observer-without-active-trace workloads never read the clock; verify the terminal-runtime focused test passes.
- [x] 7.2 Add an alternating warmed A/B benchmark for the same deterministic terminal output workload with no observer versus an installed inactive observer; verify it retains raw samples, reports both medians and the comparison method, and fails when inactive-observer overhead reaches 2 percent.
- [x] 7.3 Run the profiler-off benchmark on the implementation and record evidence that median overhead is below 2 percent; if the result exceeds the limit, reduce mark-site overhead without weakening phase correctness and rerun it.

## 8. Affected-system validation

- [x] 8.1 Run focused Vitest suites for the terminal performance report, scenario, full-app runner, desktop driver, terminal test probe, task terminal controller, terminal attachment, terminal sequencing, xterm view, and xterm presentation; verify all focused suites pass.
- [x] 8.2 Run the complete frontend and terminal-runtime validation with `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm packages:build`, and `pnpm packages:test`; verify all affected subsystem checks pass.
- [x] 8.3 Run `pnpm terminal:presentation`; verify semantic, interaction, compositor-drain, visual, and throughput checks pass with no scheduling regression from passive marks.
- [x] 8.4 Run `pnpm performance:terminal:full-app`; verify the report preserves the end-to-end shell-ready number, contains every ordered phase and segment, separates focused and full-driver echo metrics, passes equivalent correctness checks, and cleans up generated runtime data by default.
