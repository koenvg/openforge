## Context

See `proposal.md` for motivation and `specs/desktop-test-environment/spec.md` for required behavior.

The repository already has three useful pieces, but none covers the requested path by itself:

- `packages/terminal-runtime/conformance` measures renderer behavior after `TerminalView` receives synthetic output. It does not include Electron IPC, the sidecar, or a PTY.
- `scripts/electron-packaged-smoke.mjs` creates isolated runtime directories and connects Playwright to a packaged Electron app.
- `scripts/electron-dev.mjs` starts Vite, builds and launches the sidecar, and isolates worktree app data. Its current debug port starts the Electron main-process inspector rather than a renderer DevTools endpoint.

A task terminal also needs a project, task, and task-workspace record. Creating only a project and task through current desktop IPC leaves no workspace for `TaskDetailLifecycle`, while starting an implementation would launch an AI provider. The test environment therefore needs a fixture setup path that creates all three records without starting an implementation.

## Goals / Non-Goals

**Goals:**

- Keep one owner for development-app startup and shutdown so normal development, manual testing, and automated scenarios do not grow separate process-management implementations.
- Seed realistic app state through the existing database domain methods, not through ad hoc SQL or renderer store injection.
- Measure the real task-terminal path and stop timings at renderer presentation evidence.
- Keep the browser driver independent of xterm DOM and canvas details.
- Make fixture and driver code reusable by later desktop scenarios.
- Keep generated state separate from personal app data on success and failure.

**Non-Goals:**

- Replacing the existing terminal presentation conformance suite.
- Adding universal performance budgets or comparing results from different machines.
- Testing packaged release artifacts in the first change. The existing packaged smoke command remains responsible for package startup coverage.
- Starting an AI provider, exercising an agent session, or creating a pull request as part of the terminal scenario.
- Building a general desktop test suite beyond the shared lifecycle and the first terminal scenario.

## Decisions

### 1. Extract an importable development-app launcher

Move the reusable orchestration in `electron-dev.mjs` behind an importable launcher. The launcher will own Vite, sidecar preparation, Electron startup, readiness, child output capture, allocated ports, signal handling, and cleanup. The current `pnpm electron:dev` command remains a thin interactive caller with its present behavior.

The launcher will accept explicit runtime paths and Electron arguments. Automated scenarios will request a Chromium remote-debugging port, which Playwright can connect to over CDP. This stays separate from the existing Electron main-process inspector option.

Manual and automated commands will call the same launcher:

```text
fixture setup
     |
     v
shared dev launcher --> Vite
     |                sidecar
     |                Electron
     v
manual wait or Playwright scenario
     |
     v
shared shutdown and cleanup
```

Alternative considered: duplicate `electron-packaged-smoke.mjs` and replace the packaged executable with the development command. That would create another implementation of port allocation, readiness, and shutdown, then drift from `electron:dev`.

### 2. Seed fixtures through a sidecar fixture command

Add a sidecar command-line mode that prepares an isolated app-data directory before Electron starts. It will run normal database migrations, call the existing database APIs to create a project and task, and create a task-workspace record that points to the fixture repository. It will write a small JSON manifest containing the created identifiers and paths.

The mode will require an explicit fixture command and isolated app-data path. It will not listen for HTTP traffic, start PTYs, or expose a desktop IPC command. The normal sidecar startup path will not seed data.

The JavaScript fixture setup will create the temporary root and Git repository, commit deterministic files, invoke the sidecar fixture command, and read the manifest. When the caller supplies a repository, setup validates it and seeds records against that path instead.

Alternative considered: use current `create_project` and `create_task` IPC calls, then inject `taskRuntimeInfo` in the renderer. That reaches a terminal faster but bypasses persisted workspace behavior and gives future end-to-end scenarios a false app state. Ad hoc SQL was also rejected because it would duplicate schema knowledge and bypass database invariants.

### 3. Add a narrow opt-in terminal test probe

The renderer needs a stable way to observe terminal completion because xterm paints to canvas and DOM text is not reliable. Add a development-only probe enabled by the desktop test environment. It will expose serializable observations and wait operations for:

- known terminal keys and lifecycle state
- received live-output bytes and sequence continuity
- current presentation evidence and geometry
- a drain operation that resolves after the expected content reaches a presented frame

The probe will delegate to `terminalPool` and `TerminalView` rather than expose the pool, transport, or xterm instance. Production builds and normal development sessions will not install it.

Alternative considered: dynamically import `terminalPool.ts` from Playwright and inspect `_getPool()`. That is workable for a spike, but it binds scenarios to internal entry shapes and makes later terminal-runtime changes unnecessarily expensive.

### 4. Drive normal application controls after fixture setup

The Playwright driver will wait for the renderer page and verify `window.openforge.invoke` using the same health pattern as packaged smoke. It will then use accessible application controls to open the seeded project and task, find the `Terminal region for Shell 1` landmark, and use controls such as `Open new shell` when needed.

Fixture creation is setup, not the behavior under test. Once the app launches, the scenario will not set Svelte stores or call PTY IPC directly. Keyboard input and view changes go through the visible app.

### 5. Separate correctness evidence from benchmark values

The terminal scenario will run a warm-up before recording samples. It will collect:

- launch-to-shell-ready duration
- repeated driver-keypress-to-painted-echo samples, summarized with median and p95
- bulk input bytes, duration, and throughput
- fixture PTY output bytes, duration, and painted throughput
- recovery duration after leaving and reopening the task terminal view
- native process memory using the process-tree accounting pattern from the presentation and packaged smoke scripts

The fixture repository will contain a deterministic output generator. Each workload will use unique start and completion markers. A measurement succeeds only when the probe reports contiguous output, the expected byte count, the completion marker in presentation, and a renderer frame at or beyond the associated generation. The report will name input latency as driver-to-painted echo so Playwright transport cost is not mistaken for raw keyboard hardware latency.

Timing and memory values remain informational. App startup, shell readiness, output integrity, and presentation evidence are correctness checks and can fail the command.

Alternative considered: add checked-in timing thresholds immediately. The existing presentation documentation already notes that local timing depends on hardware, browser build, renderer, theme, and DPR. Thresholds would create noisy failures before enough stable-run data exists.

### 6. Use one run directory and one report contract

Each run will get a root directory containing the fixture repository, app data, Electron profile, logs, screenshots, and artifacts. Automated terminal results will be written under `artifacts/desktop-test/terminal-performance` unless the caller chooses another output directory.

The JSON report will include:

- overall and per-check status
- raw samples and summaries
- byte counts and presentation evidence
- terminal renderer, theme, DPR, rows, and columns
- operating system and architecture
- Electron, Chromium, and application revision information
- child-process diagnostics and artifact paths

The console will print the same run location and a short result summary. A retention flag keeps the complete run root. Otherwise cleanup removes generated runtime data after every child process has stopped.

### 7. Keep platform differences behind fixture and process adapters

Repository creation, path quoting, shell command construction, process-tree memory reads, and process termination differ across operating systems. The shared test environment will isolate those differences behind small adapters rather than scatter platform checks through scenarios. A platform that cannot provide a memory value will report it as unavailable, as the existing terminal presentation report does. Missing memory data will not be labeled as zero.

## Risks / Trade-offs

- [Development-only probe accidentally becomes reachable in normal sessions] -> Require both a development build and an explicit desktop-test flag, expose read-only observations, and test that the probe is absent otherwise.
- [Fixture setup diverges from real database behavior] -> Call the same migration and database methods as the app, and keep fixture-specific logic limited to choosing values and writing a manifest.
- [Benchmark noise hides or invents regressions] -> Warm up first, retain raw samples and environment metadata, summarize distributions, and avoid timing budgets in this change.
- [A failed run leaves Vite, Electron, the sidecar, or PTYs alive] -> Register one idempotent shutdown owner for normal exit, signals, launch failures, and scenario failures. Escalate termination after the existing grace period.
- [Large PTY output reaches a completion marker after intermediate data was lost] -> Record received byte counts and sequence continuity as well as final presentation evidence.
- [Remote debugging weakens a normal development session] -> Allocate a loopback-only ephemeral port only for automated runs and do not enable it for the standard development command.
- [Fixture seeding expands the sidecar command-line contract] -> Keep it additive, require explicit isolated paths, and cover refusal of unsafe or existing personal-data paths.

## Migration Plan

1. Add the sidecar fixture command and tests without changing normal sidecar startup.
2. Extract the importable development launcher while preserving the current `electron:dev` command behavior.
3. Add shared fixture, driver, reporting, and cleanup modules.
4. Add the development-only terminal test probe and verify its gating.
5. Add the headed test-app command and automated terminal performance scenario.
6. Document commands, report interpretation, retention, and current platform limitations.

Rollback removes the new commands, fixture mode, and development-only probe. No production database migration or persisted user setting needs reversal.
