## Purpose

Defines repeatable live Electron checks for terminal-state races and idle-resource regressions against OpenForge's real development application.

## ADDED Requirements

### Requirement: Isolated live development session
The E2E runner SHALL start one real development application with an isolated Electron profile, isolated Sidecar app data, an isolated database, and a disposable fixture repository. It SHALL use the shared development launch path and SHALL NOT read or mutate a developer's normal OpenForge data.

#### Scenario: Start an isolated suite
- **WHEN** an operator runs the invariant suite without reuse mode
- **THEN** the runner starts the renderer, Electron application, Rust Sidecar, and real PTY using temporary runtime paths
- **AND** the runner records those paths and process identities in the run report

#### Scenario: Reject unsafe isolated paths
- **WHEN** any isolated runtime path resolves to a configured developer app-data or database path
- **THEN** the runner refuses to start before seeding or launching the application

### Requirement: Startup readiness
The E2E runner SHALL wait for authenticated Sidecar health, event-stream availability, and completion of startup resume before running a scenario. A degraded or incomplete startup SHALL fail the suite with readiness evidence.

#### Scenario: Startup completes
- **WHEN** the Sidecar becomes healthy and startup resume completes
- **THEN** the runner records health, readiness, startup-resume, and event-stream evidence before the first scenario starts

#### Scenario: Startup does not complete
- **WHEN** health, event-stream availability, or startup resume does not reach the required state within the configured bound
- **THEN** the runner fails without starting a scenario and retains startup diagnostics

### Requirement: Reuse an existing development application
The E2E runner SHALL support attaching to an already-running development application through an explicitly configured loopback remote-debugging endpoint. Reuse mode SHALL be observational and non-destructive unless the operator separately authorizes terminal controls.

#### Scenario: Observational reuse
- **WHEN** an operator selects reuse mode without authorizing terminal controls
- **THEN** the runner does not seed data, send terminal input, delete runtime paths, close the application, or stop its processes
- **AND** scenarios requiring mutation are skipped or rejected with an actionable explanation

#### Scenario: Invalid reuse endpoint
- **WHEN** the supplied endpoint is unavailable, non-loopback, or does not identify an OpenForge development renderer
- **THEN** the runner refuses the attachment and reports the failed handshake

#### Scenario: Authorized terminal control in reuse mode
- **WHEN** the existing app was launched with E2E controls enabled and the operator explicitly authorizes terminal controls
- **THEN** the runner may execute selected terminal race scenarios without acquiring ownership of application shutdown or data cleanup

### Requirement: Production-safe E2E controls
The application SHALL expose terminal E2E controls only in a development build started with `OPENFORGE_E2E=1` and an E2E launch token. Production builds and normal development launches SHALL NOT expose those controls.

#### Scenario: Normal or production launch
- **WHEN** the app is a production build or lacks the explicit E2E environment flag or launch token
- **THEN** the terminal E2E control API is unavailable

#### Scenario: Explicit E2E launch
- **WHEN** a development app starts with the E2E environment flag and matching launch token
- **THEN** the app exposes only the documented terminal controls and diagnostics

### Requirement: Bounded terminal controls
The E2E control API SHALL provide domain-specific operations to pause and resume an authoritative terminal-state read, coordinate acquisition and recovery gates, emit validated fixture output, and read attachment, recovery, model-output-subscription, PTY-instance, and sequence diagnostics. It SHALL NOT accept arbitrary code, shell commands, backend invocations, or unrestricted terminal bytes.

#### Scenario: Emit controlled output
- **WHEN** a caller provides an allowed marker and byte count within configured bounds
- **THEN** the control emits output through a fixed fixture operation and records the corresponding diagnostic identity

#### Scenario: Reject unrestricted input
- **WHEN** a caller provides invalid marker characters, an excessive byte count, a shell command, or an unknown terminal key
- **THEN** the control rejects the request without writing to the terminal

#### Scenario: Hold an authoritative read
- **WHEN** a caller arms the next authoritative-read gate for a terminal
- **THEN** the control reports when that read is pending and does not release its result until the caller resumes the matching gate

### Requirement: Deterministic race coordination
Terminal race scenarios SHALL coordinate through deferred gates and observable state transitions. They SHALL NOT use fixed sleeps to decide when a race condition has been reached.

#### Scenario: Gate reaches its checkpoint
- **WHEN** a scenario arms a gate and triggers the corresponding application action
- **THEN** the scenario waits for the gate's reached state before performing the competing action

#### Scenario: Gate does not reach its checkpoint
- **WHEN** an armed gate does not reach its checkpoint within the configured bound
- **THEN** the scenario fails with the gate state and terminal diagnostics

### Requirement: First-attachment invariant
The live suite SHALL prove that output written after terminal acquisition and before the first view attachment appears in that first attachment.

#### Scenario: Output precedes first attachment
- **WHEN** terminal acquisition is held before attachment, controlled output is written, and acquisition resumes
- **THEN** Playwright observes the output in the first visible attachment without a detach or retry
- **AND** internal diagnostics show a continuous authoritative sequence that includes the output

#### Scenario: Stale presentation cannot pass
- **WHEN** visible text contains a marker but the authoritative-read or sequence diagnostics do not include its output identity
- **THEN** the scenario fails rather than accepting stale replay as evidence

### Requirement: Detach-during-recovery invariant
The live suite SHALL prove that detaching a terminal while authority recovery is pending cannot mark the detached view recovered or re-enable model output, and that the next attachment restores the latest authoritative output.

#### Scenario: Detach while recovery is pending
- **WHEN** an authoritative recovery read is held, the view detaches, newer controlled output is written, and the held read resumes
- **THEN** diagnostics report the view as detached and still needing recovery
- **AND** the model-output subscription remains disabled for the detached view

#### Scenario: Next attachment restores latest authority
- **WHEN** a new view attaches after the stale recovery completes
- **THEN** Playwright observes the newest controlled output
- **AND** diagnostics show that a newer authoritative read supplied the restored state

### Requirement: Complete idle-resource evidence
An idle scenario SHALL use the same measurement rules as the `performance:idle` command and SHALL report CPU, event rate, process liveness, RSS, and Sidecar current and peak footprint for the required process set. The sample SHALL fail closed when any required evidence is unavailable or incomplete.

#### Scenario: Complete idle sample
- **WHEN** all required processes remain alive and every measurement completes for the configured duration
- **THEN** the report contains process identities, CPU deltas, aggregate average cores, per-process RSS, event count and rate, event payload bytes and counts, and Sidecar current and peak footprint

#### Scenario: Required process disappears
- **WHEN** a required process exits or cannot be matched at the end of the sample
- **THEN** the idle scenario fails and identifies the missing process

#### Scenario: Required metric disappears
- **WHEN** CPU, RSS, event-stream duration, process-liveness, or Sidecar peak-footprint evidence is missing
- **THEN** the idle scenario fails even when all available measurements are below their thresholds

#### Scenario: Unsupported peak measurement platform
- **WHEN** the platform cannot provide the required Sidecar peak-footprint evidence
- **THEN** the runner reports the platform limitation and does not claim that the idle invariant passed

### Requirement: One boot with scenario filters
The runner SHALL execute compatible scenarios serially against one isolated application boot and SHALL support selecting an individual scenario without changing that scenario's assertions.

#### Scenario: Run the invariant suite
- **WHEN** an operator runs the full invariant command
- **THEN** compatible terminal and idle scenarios share one application boot and appear as separate report entries

#### Scenario: Filter one scenario
- **WHEN** an operator supplies a supported scenario filter
- **THEN** the runner executes only the selected scenario and records the filter in the report

### Requirement: Machine-readable reports and failure bundles
Every run SHALL emit a versioned machine-readable report. A failed launch, scenario, measurement, or cleanup SHALL retain a failure bundle with enough evidence to diagnose the failure without rerunning the suite.

#### Scenario: Successful run
- **WHEN** all selected scenarios and cleanup checks pass
- **THEN** the report records environment and revision data, readiness, scenario assertions, event counts, process identities, idle results, cleanup results, and artifact paths

#### Scenario: Failed run
- **WHEN** a launch, scenario, measurement, or cleanup assertion fails
- **THEN** the runner exits unsuccessfully and retains child logs, Playwright trace, screenshots, event timeline and counts, process snapshots, idle results when available, and error details

#### Scenario: Generated artifacts
- **WHEN** the runner writes reports, traces, screenshots, logs, or temporary runtime data to default locations
- **THEN** source control ignores those generated paths

### Requirement: Reliable ownership-aware cleanup
Isolated mode SHALL stop every process owned by the suite and remove temporary runtime data after copying retained artifacts. Cleanup failure SHALL fail the run. Reuse mode SHALL disconnect without stopping or deleting resources it does not own.

#### Scenario: Isolated cleanup succeeds
- **WHEN** the isolated suite finishes or aborts
- **THEN** the runner closes the controlled Electron app, stops owned child process groups, verifies that required process identities exited, and removes temporary artifacts not marked for retention

#### Scenario: Owned child survives cleanup
- **WHEN** a process owned by the isolated suite remains alive after bounded graceful and forced cleanup
- **THEN** the report marks cleanup failed and identifies the surviving process

#### Scenario: Reuse cleanup
- **WHEN** a reuse-mode run finishes
- **THEN** the runner disconnects its debugging client and leaves the existing app, processes, app data, database, and repository unchanged

### Requirement: Operator documentation and CI boundary
The project SHALL document isolated use, reuse handshake and consent rules, scenario filters, failure debugging, security boundaries, expected runtime, platform limits, and the checks suitable for CI. The change SHALL NOT enable a long-running or platform-specific required CI job without confirmed runner support.

#### Scenario: Local operator follows documentation
- **WHEN** an operator follows the documented isolated or reuse procedure
- **THEN** the commands state which resources the runner owns, which operations may mutate terminal state, and where reports are written

#### Scenario: CI configuration remains optional
- **WHEN** the E2E commands are added
- **THEN** they are available for supported runners but are not added as a required CI check by this change
