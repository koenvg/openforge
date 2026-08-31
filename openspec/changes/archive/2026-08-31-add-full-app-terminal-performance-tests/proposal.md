## Why

Terminal rendering has focused conformance coverage, but there is no repeatable way to run the development app against disposable data and measure the complete input and output path through Electron, the Rust sidecar, a real PTY, and the terminal renderer. A reusable full-app test environment will make terminal performance regressions visible now and provide a base for broader desktop end-to-end tests later.

## What Changes

- Add a command that launches the development app with isolated app data, an isolated Electron profile, and a disposable Git repository containing a ready-to-use task terminal.
- Keep the launched app open for manual terminal and workflow testing, with options to retain generated data or use a caller-supplied repository.
- Add an automated full-app terminal performance scenario that measures shell readiness, painted input latency, bulk input, PTY output rendering, recovery, and process memory.
- Write machine-readable reports and useful console summaries with enough environment metadata to compare runs on the same machine and software versions.
- Reuse the same launcher, fixture setup, driver, and cleanup code for future desktop end-to-end scenarios.
- Treat initial timing results as measurements rather than pass/fail budgets. Correctness failures such as missing output, a failed terminal launch, or incomplete rendering still fail the scenario.

## Capabilities

### New Capabilities

- `desktop-test-environment`: Launch and drive an isolated development app with deterministic repository data, manual inspection support, full-app terminal performance measurements, reports, and safe cleanup.

### Modified Capabilities

None.

## Impact

- Development and test scripts for Electron process startup, Playwright connection, temporary runtime directories, and report generation.
- Rust database test-fixture support for creating a project, task, and workspace without starting an AI provider.
- Terminal runtime test observation needed to wait for painted output and inspect presentation evidence without coupling tests to xterm internals.
- Root package scripts and focused tests for fixture setup, launch failure handling, cleanup, measurement correctness, and report output.
- No production data migration, external API change, or user-facing compatibility break.
