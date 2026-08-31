## 1. Fail-closed idle sampling

- [x] 1.1 Add failing unit tests for CLI options, stable process-role selection, start/end identity matching, CPU and RSS completeness, full-duration event evidence, Sidecar peak footprint, threshold failures, and evidence failures; verify the focused idle tests fail against the current coupled CLI.
- [x] 1.2 Extract Sidecar discovery, event counting, process sampling, footprint collection, aggregation, and report formatting into importable modules while keeping `pnpm performance:idle` defaults and JSON fields compatible; verify the focused idle tests pass.
- [x] 1.3 Make every selected stable process role fail closed when its end identity, CPU counter, or RSS is missing, and distinguish evidence failures from threshold failures; verify injected disappearance and unavailable-metric tests pass.
- [x] 1.4 Add authenticated `/debug/process-memory` collection for E2E idle evidence without replacing OS accounting; verify tests cover success, redaction, HTTP failure, and unavailable diagnostics.

## 2. Playwright Electron launch and execution ownership

- [x] 2.1 Add failing launcher tests for a Playwright Electron adapter, normalized PID and exit handling, Electron-first shutdown, retained child logs, and unchanged normal `electron:dev` spawning; verify the focused launcher tests fail before implementation.
- [x] 2.2 Add the injectable Electron launch adapter to the shared development launcher and implement the Playwright Electron adapter; verify launcher tests prove both adapters use the same Vite, build, environment, port, and cleanup path.
- [x] 2.3 Add failing lifecycle tests for isolated ownership, unsafe app-data rejection, reuse non-ownership, loopback-only endpoint validation, renderer identity checks, and terminal-control consent; verify the focused lifecycle tests fail.
- [x] 2.4 Extend the desktop-test lifecycle with isolated and reuse execution policies, including CDP reuse attachment that never seeds, closes, signals, or deletes external resources; verify the lifecycle tests pass and existing desktop performance lifecycle tests remain green.
- [x] 2.5 Add Sidecar health, readiness, startup-resume, process identity, and event-stream startup coordination using the shared discovery code; verify tests cover complete, degraded, timed-out, and event-already-emitted startup states.
- [x] 2.6 Add a loopback Chromium debugging option to the normal development command for documented reuse sessions; verify parser and launch-argument tests reject invalid or non-loopback configurations and preserve default behavior.

## 3. Gated terminal controls and diagnostics

- [x] 3.1 Add failing tests for the deferred-gate coordinator, including state transitions, terminal-key scoping, matching resume, timeout diagnostics, cancellation, and duplicate operations; verify the tests fail before the coordinator exists.
- [x] 3.2 Implement acquisition and post-response authoritative-read checkpoints with deferred gates, without changing normal Terminal Runtime timing; verify unit and integration tests prove gates are inert when E2E mode is disabled.
- [x] 3.3 Add failing Rust command-boundary tests for E2E fixture output, including missing environment flag, unknown terminal, invalid marker, excessive bytes, arbitrary command input, and a successful fixed generator invocation; verify the focused Rust tests fail.
- [x] 3.4 Implement the E2E-only Sidecar fixture-output command and camelCase typed renderer wrapper, with independent validation and no arbitrary command field; verify focused Rust, IPC registry, and TypeScript contract tests pass.
- [x] 3.5 Add failing tests for model-output subscription snapshots and terminal diagnostics covering desired, pending, registered, disposed, attachment generation, recovery-needed, PTY instance, authority-read application, and sequence continuity states.
- [x] 3.6 Implement read-only subscription and authority diagnostics from existing Terminal Runtime state, preserving Terminal State Authority and plugin event payloads; verify terminal-runtime and desktop transport tests pass.
- [x] 3.7 Replace the current query-only terminal probe with a frozen E2E control API guarded by development build, `OPENFORGE_E2E=1`, and a matching launch token; verify tests and production-build inspection show the API is absent from normal development and production launches.

## 4. Event evidence, reports, and failure artifacts

- [x] 4.1 Add failing tests for a redacted event recorder that writes append-only NDJSON, counts names and payload bytes, preserves event IDs and required terminal sequence metadata, and reports gaps or partial streams.
- [x] 4.2 Implement the event recorder against the existing authenticated Sidecar event stream; verify fragmented SSE, keepalive, reconnect, redaction, gap, and bounded shutdown tests pass.
- [x] 4.3 Add failing tests for a versioned run report containing mode, filters, environment, readiness, scenario assertions, diagnostics, process identities, idle evidence, cleanup, and artifact paths; verify incomplete required sections cannot serialize as a passing report.
- [x] 4.4 Implement atomic report persistence and failure-bundle capture for child logs, trace chunks, screenshots, event timeline and counts, process snapshots, idle results, and error details; verify success, launch failure, scenario failure, and cleanup failure tests produce the expected artifact manifest.

## 5. Serial invariant runner and scenario drivers

- [x] 5.1 Add failing command-parser and orchestration tests for `e2e:dev`, `e2e:invariants`, supported scenario filters, reuse endpoint, terminal-control consent, retention, timeout overrides, one boot, serial order, and stop-after-mutation-failure behavior.
- [x] 5.2 Implement the Node E2E runner with one lifecycle, Playwright trace chunks, scenario selection, idempotent signal handling, report finalization, and ownership-aware shutdown; verify orchestration tests pass without launching Electron.
- [x] 5.3 Add failing driver tests for task selection, terminal view attach and detach through normal UI controls, gate operations, controlled markers, visible terminal assertions, and diagnostic capture; verify the focused driver tests fail before implementation.
- [x] 5.4 Extend the desktop driver with the bounded E2E operations while retaining role-based Playwright selectors and typed page results; verify existing terminal performance driver tests and new driver tests pass.
- [x] 5.5 Implement the first-attachment scenario using an acquisition gate, controlled output, first-view Playwright assertion, and authoritative sequence checks; verify scenario tests reject missing output, an unintended reattach, discontinuous sequence, and stale visible replay.
- [x] 5.6 Implement the detach-during-recovery scenario using a held post-response authority read, UI detach, newer controlled output, stale-read release, detached subscription checks, and a fresh attachment; verify scenario tests reject recovered detached state, output re-enable, stale authority, and missing latest output.
- [x] 5.7 Implement the idle-resource scenario using the shared sampler and debug-memory evidence after UI quiescence; verify scenario tests reject unsupported peak evidence, missing stable processes, partial event duration, and unavailable metrics.

## 6. Live development-app coverage

- [x] 6.1 Run the first-attachment scenario against an isolated real development app and real PTY; verify the first visible attachment contains the unique marker and the report records matching authoritative sequence evidence.
- [x] 6.2 Run the detach-during-recovery scenario in the same boot; verify the detached view remains recovery-needed with model output disabled and the next attachment displays the newest marker from a later authority read.
- [x] 6.3 Run the full-duration idle scenario in the same boot on a supported macOS host; verify the report contains complete CPU, event-rate, process-liveness, RSS, Sidecar current and peak footprint, and `/debug/process-memory` evidence.
- [x] 6.4 Force one scenario failure and one cleanup failure with test-only dependencies; verify each run exits unsuccessfully and retains a readable report, trace, screenshot, logs, event evidence, process identities, and cleanup details.
- [x] 6.5 Exercise observational reuse against an explicitly remote-debuggable development app without terminal-control consent; verify the report shows no fixture setup, input, process signals, application close, or path deletion.

## 7. Commands, generated files, and operator documentation

- [x] 7.1 Add `e2e:dev` and `e2e:invariants` package scripts with individual scenario filtering and reuse options; verify package-script tests and `--help` output list the supported commands and consent rules.
- [x] 7.2 Ignore default desktop E2E reports, Playwright output, test results, and temporary runtime paths; verify `git status --ignored` identifies generated test artifacts as ignored.
- [x] 7.3 Document isolated use, the remote-debugging reuse handshake, terminal-control consent, filters, ownership, security checks, expected runtime, macOS idle limitation, report contents, and failure debugging; verify every documented command matches `--help` output.
- [x] 7.4 Document CI suitability without adding a required workflow, including runner prerequisites and the distinction between portable terminal races and macOS peak-footprint evidence; verify no required CI configuration changes are present.

## 8. Affected-system validation and handoff

- [x] 8.1 Run focused Vitest suites for the launcher, lifecycle, controls, transport diagnostics, idle sampler, event recorder, report writer, runner, drivers, and scenarios; record commands and results and verify all focused tests pass.
- [x] 8.2 Run `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm electron:contract:check`, `pnpm packages:test`, and `pnpm terminal:presentation`; record results and any environment-specific presentation limitation.
- [x] 8.3 From the backend crate root, run `cargo test`, `cargo check`, `cargo build`, and `cargo clippy`; verify the E2E-only command is denied without its flag and no Rust warnings are introduced.
- [x] 8.4 Run `pnpm e2e:invariants` in isolated mode and run each scenario through its individual filter; verify one boot is used for the full suite, all reports pass, and no owned process or temporary runtime artifact survives cleanup.
- [x] 8.5 Inspect a successful report and a forced failure bundle for required readiness, trace, screenshot, event, process, idle, and cleanup evidence; verify generated paths remain outside source control.
- [x] 8.6 Update Handoff Notes with every validation command and result, observed runtime, supported platforms, reuse limitations, CI status, cleanup confirmation, skipped checks, coverage gaps, and follow-up work; verify the notes match the final task diff and artifacts.
