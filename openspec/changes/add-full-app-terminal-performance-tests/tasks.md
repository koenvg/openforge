## 1. Fixture repository and persisted app state

- [x] 1.1 Add failing Rust tests for the sidecar fixture command covering argument validation, isolated app-data refusal rules, migrations, project creation, task creation, task-workspace creation, and JSON manifest output; verify the focused cargo test fails for the expected missing behavior.
- [x] 1.2 Implement the sidecar fixture command through existing database APIs without starting HTTP, PTY, or provider services; verify the focused Rust fixture-command tests pass.
- [x] 1.3 Add failing JavaScript tests for generated Git fixtures, caller-supplied repositories, deterministic committed files, invalid paths, and fixture manifest parsing; verify the focused Vitest run fails for the expected missing setup module.
- [x] 1.4 Implement the repository and app-data fixture setup with platform-specific command handling kept behind adapters; verify the focused fixture setup tests pass on the active platform.

## 2. Shared development app launcher

- [x] 2.1 Extend the existing electron-dev tests with failing cases for importable startup, explicit isolated runtime paths, loopback Chromium remote debugging, child output capture, readiness failure, idempotent shutdown, and signal cleanup; verify the focused test run fails for the new expectations.
- [x] 2.2 Extract the reusable development-app launcher and keep `pnpm electron:dev` as a thin caller with unchanged normal behavior; verify the electron-dev test suite passes and a normal development launch still omits Chromium remote debugging.
- [x] 2.3 Reuse packaged-smoke readiness and process-lifecycle helpers where their contracts match, or extract shared helpers when needed; verify packaged smoke and electron-dev tests pass without duplicated port-allocation or shutdown implementations.

## 3. Terminal test observation

- [x] 3.1 Add failing terminal-runtime and renderer tests for an opt-in development probe that is absent from production and normal development sessions, exposes no writable transport or xterm object, and reports lifecycle, byte-count, sequence, geometry, and presentation-drain evidence; verify the focused tests fail for the missing probe.
- [x] 3.2 Implement the gated read-only terminal probe through `terminalPool` and `TerminalView`; verify focused terminal-runtime and renderer tests pass, including incomplete-sequence and missing-marker cases.

## 4. Desktop test lifecycle and driver

- [x] 4.1 Add failing tests for run-directory creation, generated and supplied repository setup, fixture seeding, allocated ports, CDP connection options, artifact paths, retention, default cleanup, launch failure, scenario failure, and repeated shutdown; verify the focused desktop test lifecycle suite fails for the expected missing modules.
- [x] 4.2 Implement the shared desktop test lifecycle that composes fixture setup, the development launcher, Playwright connection, diagnostics, artifacts, and cleanup; verify the focused lifecycle tests pass without using personal OpenForge data directories.
- [x] 4.3 Implement a Playwright app driver that verifies the desktop bridge and uses accessible controls to open the seeded project, task, and shell terminal; verify a focused full-app smoke run reaches `Terminal region for Shell 1` and executes a command in the seeded repository.

## 5. Full-app terminal performance scenario

- [x] 5.1 Add failing tests for warm-up handling, median and p95 calculations, throughput calculations, environment metadata, unavailable memory, informational timing values, correctness failures, and JSON report serialization; verify the focused report tests fail for the missing scenario code.
- [x] 5.2 Add the deterministic terminal output generator and implement shell-readiness, driver-to-painted echo, bulk-input, PTY-output, and view-recovery measurements using unique markers and renderer drain evidence; verify a focused full-app run records every metric and fails when expected bytes, sequence continuity, markers, or presentation evidence are missing.
- [x] 5.3 Add native Electron process-tree memory collection by reusing the existing terminal presentation accounting rules; verify tests distinguish app, renderer, GPU, complete process-tree RSS, JavaScript heap, and unavailable values.
- [x] 5.4 Write `report.json`, failure diagnostics, screenshots, child logs, and a concise console summary under the selected artifact directory; verify success and forced-failure runs produce complete reports with the correct exit statuses and retained diagnostics.

## 6. Commands and documentation

- [x] 6.1 Add manual test-app and automated terminal-performance package commands with options for supplied repository, retained runtime data, and output directory; verify CLI parsing tests cover valid options, invalid repositories, unknown options, and cleanup defaults.
- [x] 6.2 Document how to launch the headed test app, run the automated scenario, find artifacts, retain generated data, interpret driver-to-painted timings, and compare only equivalent environments; verify every documented command matches a package script or supported option.

## 7. Affected-system validation

- [x] 7.1 Run the focused JavaScript, terminal-runtime, Electron launcher, and Rust fixture tests; verify all focused suites pass and record the commands used.
- [x] 7.2 Run `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm electron:contract:check`, and `pnpm terminal:presentation`; verify the renderer, desktop boundary, package, and terminal presentation checks pass or document any environment-specific presentation gap.
- [x] 7.3 From the backend crate root, run `cargo test`, `cargo check`, and `cargo clippy`; verify the complete Rust subsystem passes without warnings introduced by the fixture mode.
- [x] 7.4 Launch the headed test app against a generated fixture, manually confirm the seeded task terminal is usable, then run the automated terminal performance command; verify both modes clean up by default and the automated report contains all required correctness evidence and measurements.
