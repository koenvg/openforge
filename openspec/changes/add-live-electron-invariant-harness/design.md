## Context

See `proposal.md` for motivation and `specs/desktop-e2e-invariants/spec.md` for behavior.

The completed `add-full-app-terminal-performance-tests` change already introduced an importable development launcher, isolated fixture seeding, a desktop-test lifecycle, CDP-based page driving, bounded child logs, screenshots, terminal observations, and process-tree memory sampling. The new runner must deepen that path rather than create another launcher.

The installed Playwright Electron API can launch an Electron application and inspect its main process, but it cannot attach to an existing Electron application. Chromium CDP remains necessary for reuse mode. The Rust Sidecar already provides authenticated health, durable readiness, an event stream, process-memory diagnostics, and terminal authority reads. The existing idle command already defines CPU, event-rate, RSS, and macOS peak-footprint accounting, but its CLI and measurement code are coupled and it silently omits some processes that disappear during a sample.

Terminal Runtime already rejects stale attachment generations and queues model output behind authoritative snapshot replacement. Existing integration tests prove those rules with fake transports. The live suite must reach the same checkpoints in the real app and must distinguish authoritative recovery from stale visible replay.

## Goals / Non-Goals

**Goals:**

- Keep launch, fixture, Sidecar, terminal, and idle behavior owned by their existing modules.
- Give each race a deterministic checkpoint that can be observed and released without timing sleeps.
- Keep isolated and reuse ownership rules explicit in code and in the report.
- Make every pass claim depend on both renderer presentation and internal sequence evidence.
- Produce useful artifacts even when launch or cleanup fails before a scenario completes.

**Non-Goals:**

- Replace the terminal-runtime integration suites or terminal performance benchmark.
- Add general-purpose test RPC, arbitrary shell execution, or a production diagnostics API.
- Make the macOS `vmmap` peak-footprint check portable in this change.
- Make the macOS idle-resource gate a required check on every pull request; it remains scheduled and manually dispatchable.
- Promise scenario isolation after a failed mutating scenario. The runner stops later scenarios when the shared app state is no longer trustworthy.

## Decisions

### 1. Add a Playwright launch adapter to the shared development launcher

Isolated mode will pass a Playwright Electron launch adapter into `createElectronDevLauncher`. The launcher will continue to own Vite startup, artifact preparation, Rust build, Electron environment construction, ports, child output, and cleanup. The adapter will replace only the final Electron spawn and return a normalized process handle plus the `ElectronApplication` and renderer page.

The normalized handle will let existing launcher code observe PID and exit state while E2E cleanup closes the `ElectronApplication` before the launcher stops remaining process groups. The normal `pnpm electron:dev` path will keep its current child-process adapter.

Alternative considered: launch the existing CLI and attach over CDP in isolated mode. That would leave the new suite short of the Playwright Electron requirement and would lose direct main-process and Electron-application lifecycle control.

Alternative considered: let Playwright build and launch the app independently. That would duplicate the development launcher and drift from `electron:dev`.

### 2. Model isolated and reuse execution as ownership policies

The desktop-test lifecycle will gain an execution policy rather than scattered mode checks.

```text
                     isolated                  reuse
                     --------                  -----
app launch           owned                     external
fixture and app data owned, temporary          untouched
Electron shutdown    required                  forbidden
process cleanup      required                  forbidden
terminal controls    enabled for fixture       disabled by default
Playwright access    Electron API               loopback CDP
```

Reuse mode will accept a loopback CDP endpoint, verify that a page is an OpenForge development renderer, and record the endpoint and discovered process identities. It will not call fixture setup or launcher shutdown. Mutating scenarios will require both an E2E-enabled renderer and an explicit `--allow-terminal-control` option. Without both, the runner will reject a requested mutating scenario before interacting with the terminal.

The development command will accept a documented Chromium debugging port through a narrow option or environment variable. It will not expose a non-loopback listener.

Alternative considered: infer a debug endpoint from running processes. Explicit endpoints are safer when several development apps are running and make the consent boundary visible.

### 3. Use Sidecar readiness as durable startup evidence and the event stream as the timeline

After Electron starts, the lifecycle will discover the Sidecar owned by that Electron PID and reuse the existing authenticated Sidecar discovery logic currently embedded in the idle checker. It will call `/app/health`, then poll `/app/readiness` until events are available and `startupResume.phase` is `complete`. A `degraded` phase or timeout fails startup.

The runner will open `/app/events` as soon as Sidecar identity is known and retain event IDs, names, receipt times, payload byte counts, and terminal sequence metadata needed by assertions. Full payloads will be omitted or redacted by default. The readiness endpoint is the durable answer when `startup-resume-complete` occurred before the runner subscribed; the timeline records the event when it is observed live.

Alternative considered: wait only for the renderer bridge. That proves IPC is callable but does not prove startup resume or event delivery is ready.

### 4. Install the terminal control API behind three checks

The renderer control module will load only when all of these are true:

1. Vite compiled a development build.
2. The development process was started with `OPENFORGE_E2E=1`.
3. The renderer URL contains the unpredictable token generated for that run.

The launcher will translate the host flag into the renderer's Vite environment and add the token to the trusted renderer URL. Production builds will remove the conditional module. Normal development launches will not add the token or expose the global API.

The public control object will be frozen and limited to terminal gate operations, validated fixture output, and serializable diagnostics. The Sidecar fixture-output command will independently require `OPENFORGE_E2E=1`, validate the terminal key, marker alphabet, and byte limit, and construct a fixed invocation of the seeded output generator. It will not accept command text. Renderer calls will use a typed wrapper in `src/lib/ipc.ts`.

Alternative considered: expose raw PTY input through the control object. Even behind an environment flag, that is arbitrary command execution and is unnecessary for these scenarios.

### 5. Put gates at authority boundaries, not in scenario timing code

A small deferred-gate coordinator will own gate IDs and states: `armed`, `reached`, `resumed`, `cancelled`, or `timed-out`.

Two checkpoints are required:

- An acquisition checkpoint after Terminal Runtime returns the entry but before the first view calls attach.
- An authoritative-read checkpoint after the Sidecar response has been captured but before the renderer transport returns it to Terminal Runtime.

Holding the read after response capture is important. It produces a genuinely stale recovery result while newer output can enter Sidecar authority. A gate before the request would only delay the read and could return the newest state, which would not test stale completion rejection.

Every gate wait has a timeout for deadlock prevention. The timeout is not used to schedule race actions. Detach, output, and resume actions occur only after the gate reports `reached`.

Alternative considered: delay Sidecar responses or add sleeps in the scenario. Sidecar delay would widen the contract change, while sleeps would remain machine-dependent.

### 6. Extend diagnostics without changing terminal ownership

The control API will read Terminal Runtime state rather than maintaining a second terminal model. Diagnostics will include attachment and visibility generations, attachment and recovery flags, PTY instance, terminal state source, received bytes, first and last live sequences, authoritative model sequence, and continuity.

The live model-output subscription lifecycle will expose a read-only snapshot containing desired, registration-pending, registered, and disposed state. Authority-read diagnostics will include gate ID, read generation, captured PTY instance and watermark, and whether that result was applied or rejected. Fixture-output diagnostics will record an operation ID and the sequence baseline at emission.

These additions are observations only. Terminal Runtime remains the attachment owner, the Rust Sidecar remains the state authority, and existing plugin event names and payloads do not change.

Alternative considered: infer subscription state from event counts. A quiet terminal makes that ambiguous and cannot prove output stayed disabled after detach.

### 7. Run scenarios serially in a purpose-built command

A Node command will orchestrate the installed Playwright library directly, matching the existing full-app performance command. It will launch once, start tracing, run selected scenarios serially, and shut down once. Unit tests remain under Vitest. The live scenarios will not join the root `pnpm test` command.

Commands will include:

- `pnpm e2e:dev` for the development E2E runner.
- `pnpm e2e:invariants` for the invariant suite.
- `--scenario <name>` for `first-attachment`, `detach-during-recovery`, or `idle-resources`.
- `--reuse <loopback-endpoint>` and `--allow-terminal-control` for explicit attachment behavior.

The runner will stop after a mutating scenario failure because later results could inherit unknown terminal state. Compatible successful scenarios share one boot.

Alternative considered: add Playwright Test as another dependency. Its worker and fixture lifecycle adds little here because the suite must own one serial app session and already needs a custom cross-scenario report.

### 8. Extract one fail-closed idle sampler

`performance:idle` and the E2E idle scenario will call the same importable sampler. Parsing, process discovery, event counting, platform footprint collection, aggregation, threshold evaluation, and formatting will be separate testable units with injected process and clock dependencies.

The sampler will capture the required process set at the start and match the same identities at the end. Electron main, renderer, GPU, Sidecar, and any explicitly included plugin host become required once selected. Missing identity, CPU counter, RSS, full-duration event evidence, or Sidecar peak footprint is an evidence failure, not a dropped row. Threshold failures remain separate from evidence failures in the report.

The idle scenario will also collect `/debug/process-memory` so failure bundles include Sidecar-owned PTY and plugin-host memory diagnostics without replacing OS process accounting.

Alternative considered: invoke `pnpm performance:idle` as a child and parse stdout. That preserves duplicated orchestration and makes partial evidence and process ownership harder to test.

### 9. Use one versioned run report and append-only evidence files

Each run will create `artifacts/desktop-e2e/<run-id>/report.json`. The report will contain:

- mode, selected scenarios, timing, revision, platform, and versions
- runtime paths in isolated mode, with sensitive values redacted
- readiness and startup-resume evidence
- per-scenario assertions and terminal diagnostics
- event counts and references to an NDJSON timeline
- initial, sampled, and cleanup process identities
- idle measurements and evidence failures
- cleanup outcome and artifact paths

Tracing starts once and uses scenario chunks. Successful chunks may be discarded; a failed scenario writes a trace. Failure handling captures a screenshot, child logs, current diagnostics, process snapshot, event summary, and stack before cleanup. Cleanup failure updates the report after scenario results have been written.

Default artifact and Playwright output paths will be ignored by source control. Temporary app data remains under the system temporary directory and is removed unless `--retain` is set.

Alternative considered: rely on Playwright's built-in report formats. They do not contain Sidecar, idle, terminal sequence, or ownership-aware cleanup evidence.

### 10. Verify cleanup as an invariant

Isolated cleanup will close the Playwright Electron application, stop launcher-owned process groups, poll every recorded required PID for exit, escalate within existing shutdown budgets, copy final logs, then remove temporary runtime paths. A surviving owned PID or failed removal makes the run unsuccessful.

Reuse cleanup will stop event recording and disconnect the CDP client. It will not invoke Electron close, signal a PID, or remove any path. Unit tests will assert these negative obligations.

Signal handlers will route through the same idempotent cleanup path so interruption cannot bypass ownership rules.

### 11. Split continuous terminal enforcement from scheduled idle evidence

The repository's existing `macos-14` Rust and packaged-Electron jobs confirm an Electron-capable hosted runner. Pull-request CI will run `first-attachment` and `detach-during-recovery` in one boot after frontend and Rust checks pass. The job will always upload its report root so failed races retain the same diagnostics as local runs.

The 30-second idle gate will run in a separate weekly and manually dispatchable macOS workflow. This keeps `vmmap` evidence on a supported host without making every pull request wait for a platform-specific idle measurement. Both workflows use the same checked-in commands as local operators.

## Risks / Trade-offs

- [Playwright Electron launch handles differ from Node child processes] -> Normalize only the process operations the shared launcher needs and test graceful and forced cleanup through injected adapters.
- [The startup completion event can precede event subscription] -> Treat authenticated `/app/readiness` as durable completion evidence and record the event when observed.
- [A fixed fixture-output command still writes to a shell] -> Allow it only for E2E-enabled fixture sessions, validate every argument twice, cap bytes, and require explicit consent in reuse mode.
- [One boot lets a failed scenario contaminate later scenarios] -> Run serially, restore a known UI state after success, and stop after a mutating failure.
- [Tracing and active Playwright polling can disturb idle CPU] -> Quiesce UI interaction before sampling, avoid polling during the sample, and keep Playwright outside the Electron process tree accounting.
- [Short idle samples can hide low-rate event churn] -> Keep the existing 30-second default and allow explicit characterization overrides in local runs.
- [macOS peak footprint is not portable] -> Keep idle evidence out of the pull-request gate and run it in a separate scheduled/manual macOS workflow.
- [Process role matching can mistake transient utilities for required processes] -> Define required stable roles explicitly and report optional process arrivals separately.

## Migration Plan

1. Extract and test shared Sidecar discovery and idle sampling while keeping `pnpm performance:idle` output and defaults compatible.
2. Add the launcher adapter and ownership-aware lifecycle behind new E2E commands. Keep existing development and terminal-performance commands unchanged.
3. Add the gated terminal controls and unit tests proving they are absent from normal development and production builds.
4. Add the serial live scenarios, report writer, artifacts, documentation, and source-control ignores.
5. Run focused tests, full renderer and package checks, Electron contract checks, terminal presentation checks, Rust validation for the E2E Sidecar command, and the live isolated suite.
6. Record commands, results, platform limits, runtime, and follow-up work in Handoff Notes.
7. After confirming the existing macOS runner and runtime budget, add pull-request terminal-race enforcement and a separate scheduled/manual macOS idle workflow.

Rollback removes the new commands and control module, restores the idle CLI wrapper to its previous entry point, and leaves production terminal and event contracts unchanged.

## Handoff Notes

Implementation and validation completed on a macOS arm64 development host.

### Commands and results

- `pnpm i` completed before implementation; `pnpm-lock.yaml` did not change.
- Focused Vitest command covering 18 launcher, lifecycle, policy, readiness, control, transport, sampler, recorder, report, runner, driver, and scenario files: 18 files and 167 tests passed.
- `pnpm test`: 613 files passed, 1 file skipped; 5,030 tests passed and 7 skipped.
- `pnpm exec tsc --noEmit`: passed with no diagnostics.
- `pnpm lint`: passed with no diagnostics.
- `pnpm electron:contract:check`: passed with no generated-contract drift.
- `pnpm packages:test`: plugin runtime 36 files/258 tests passed; terminal runtime 51 files/208 tests passed.
- `pnpm terminal:presentation`: passed and wrote `artifacts/terminal-presentation/report.json`. No host-specific presentation limitation was encountered.
- From `src-tauri`, `cargo test`: 1,832 unit tests, 3 integration tests, and 1 additional test passed; 1 test was ignored. The `e2e_fixture_output_is_gated_bounded_and_fixed` test verified that the fixture command returns `FORBIDDEN` without `OPENFORGE_E2E=1`.
- From `src-tauri`, `cargo check`, `cargo build`, and `cargo clippy`: passed without warnings.
- `pnpm e2e:invariants -- --output artifacts/desktop-test/final-full`: all three scenarios passed in one boot in 43.0 seconds.
- `pnpm e2e:invariants -- --scenario first-attachment --output artifacts/desktop-test/final-first-attachment`: passed in 13.6 seconds.
- `pnpm e2e:invariants -- --scenario detach-during-recovery --output artifacts/desktop-test/final-detach-during-recovery`: final run passed in 12.9 seconds. An earlier run exposed a task-navigation race; the driver now falls back to normal project navigation when the Back action does not detach within its bounded presentation check, with regression coverage.
- `pnpm e2e:invariants -- --scenario idle-resources --output artifacts/desktop-test/final-idle-resources`: passed in 40.1 seconds with the default 30-second macOS idle sample.
- Workflow contract TDD: `scripts/e2e-invariants.test.mjs` failed before the CI workflows existed, then passed 3/3 tests after implementation.
- The exact pull-request CI command (`first-attachment` plus `detach-during-recovery` with the CI output root) passed locally in one boot in 32.5 seconds.
- The exact scheduled idle command (`idle-resources` with the CI output root) passed locally in 41.2 seconds.
- `actionlint .github/workflows/ci.yml .github/workflows/live-electron-idle.yml` and Ruby YAML parsing passed.
- Observational reuse used an explicitly remote-debuggable E2E development app and `pnpm e2e:invariants -- --reuse <loopback-endpoint> --scenario idle-resources --idle-duration 15 --output artifacts/desktop-test/live-reuse-observational`: passed without terminal-control consent. The attached Electron and Sidecar PIDs and the owner-created runtime directory remained present after the reuse runner disconnected; its report records null fixture paths, no removals, and `processExitVerified: false`.
- `pnpm e2e:invariants -- --scenario first-attachment --scenario-timeout 1 --output artifacts/desktop-test/final-forced-failure`: exited 1 as intended in 6.8 seconds and retained a readable report, trace, screenshot, child log, event evidence, process snapshot, error, and passing cleanup evidence.
- `pnpm e2e:invariants -- --help`: exited 0 and matched every harness command and option documented in `docs/live-electron-invariants.md`.
- `git check-ignore` and `git status --ignored` confirmed reports, Playwright reports, test results, and temporary runtime paths are ignored.
- `openspec validate add-live-electron-invariant-harness --strict`: passed.

### Runtime, ownership, and evidence

The final full report is `artifacts/desktop-test/final-full/report.json`. It contains complete readiness, three passing serial scenarios, three trace chunks, four Playwright screenshots, authenticated event timeline/counts, process identities, passing idle evidence, and passing cleanup. Each final isolated report records verified process exit, and every reported temporary runtime path was absent after cleanup. A process-table check found no surviving command associated with an `openforge-desktop-test-*` runtime.

The retained forced-failure bundle is under `artifacts/desktop-test/final-forced-failure/`. Both that bundle and the successful report have readable artifact paths and are ignored by source control.

### Platforms, reuse, and CI

The first-attachment and detach-during-recovery scenarios are portable to hosts supported by the development Electron stack. Complete idle validation is macOS-specific because Sidecar peak footprint uses `vmmap`; no non-macOS live idle claim was made.

Reuse accepts only HTTP loopback CDP endpoints and verifies an OpenForge development renderer. It is observational unless both `--allow-terminal-control` and matching token-gated renderer controls are present. Reuse does not own fixture data, application processes, or paths. Observational reuse was exercised live; consented terminal control in reuse remains covered by policy/control tests and by the same controls exercised in isolated live terminal scenarios.

Pull-request CI now runs both terminal race scenarios in one boot on the existing `macos-14` runner after frontend and Rust checks. A separate weekly/manual macOS workflow runs the full idle gate. Both jobs always upload their report roots; the PR job retains evidence for seven days and the idle job for fourteen days.

### Skips, gaps, and follow-up

All requested validation commands ran. The root suite retained its existing 1 skipped file/7 skipped tests, and Cargo retained 1 ignored test. There was no non-macOS live run and no live consented reuse terminal run; neither is required for this change, and the relevant portable policy/control paths have focused coverage. Hosted CI execution of the newly added jobs remains pending on the pull request. No adjacent cleanup task or additional follow-up work was identified.
