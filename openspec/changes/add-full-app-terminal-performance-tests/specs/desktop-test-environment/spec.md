## Purpose

Provides a repeatable isolated development app for manual desktop testing and automated measurement of the complete task-terminal path.

## ADDED Requirements

### Requirement: Isolated development app
The system SHALL launch the development app with a dedicated app-data directory, Electron user-data directory, backend port, renderer connection, and Git repository that do not reuse the operator's normal OpenForge runtime data.

#### Scenario: Launch with generated fixture repository
- **WHEN** a developer starts the test app without supplying a repository
- **THEN** the system creates a disposable Git repository with deterministic committed content
- **AND** the launched app contains a project, task, and workspace that point to that repository
- **AND** the task terminal can start a real shell in the fixture workspace without starting an AI provider

#### Scenario: Launch with supplied repository
- **WHEN** a developer starts the test app with a valid repository path
- **THEN** the launched app uses that repository for the seeded project and task workspace
- **AND** the app still uses isolated runtime data

#### Scenario: Invalid repository
- **WHEN** a developer supplies a path that is not a usable Git repository
- **THEN** the command exits with a non-zero status and identifies the invalid path
- **AND** no Electron app remains running

### Requirement: Manual test session
The system SHALL provide a headed mode that leaves the test app open until the developer closes it or stops the command.

#### Scenario: Inspect the task terminal
- **WHEN** the headed test app becomes ready
- **THEN** the developer can open the seeded task and use its shell terminals through the normal application interface
- **AND** the command prints the repository, runtime-data, and artifact locations

#### Scenario: Retain generated data
- **WHEN** the developer requests retained runtime data
- **THEN** the command preserves the generated repository, app data, Electron profile, and artifacts after the app exits
- **AND** the command prints the preserved locations

### Requirement: Full-app terminal performance scenario
The system SHALL provide an automated scenario that drives a real task shell through the Electron renderer, desktop IPC, Rust sidecar, PTY, terminal model, terminal runtime, and renderer.

#### Scenario: Measure shell readiness
- **WHEN** the automated terminal scenario launches the seeded task
- **THEN** the report records the elapsed time until the shell accepts input
- **AND** the scenario verifies that the terminal belongs to the seeded workspace

#### Scenario: Measure painted input
- **WHEN** the scenario sends deterministic keyboard input and bulk text to the terminal
- **THEN** it records input-to-painted-output timing and bulk input throughput
- **AND** it stops each measurement only after the expected terminal content has reached a presented renderer frame

#### Scenario: Measure PTY output rendering
- **WHEN** the fixture command emits a known byte sequence through the real PTY
- **THEN** the scenario records bytes, elapsed time, and rendered throughput
- **AND** it fails if the completion marker is missing or presentation evidence does not cover the emitted output

#### Scenario: Measure recovery and memory
- **WHEN** the scenario completes its input and output workloads
- **THEN** it records terminal recovery timing after a defined detach, reattach, or resize operation
- **AND** it reports available renderer, GPU, app-process, and complete process-tree memory values without describing JavaScript heap as total process memory

### Requirement: Performance report
The system SHALL write a machine-readable report and a concise console summary for every automated terminal performance run.

#### Scenario: Successful report
- **WHEN** all correctness checks complete
- **THEN** the report includes scenario status, timing and throughput values, measurement evidence, fixture geometry, terminal renderer, operating system, architecture, Electron and browser versions, and artifact paths
- **AND** the command exits successfully

#### Scenario: Informational timing results
- **WHEN** measured timings differ from a previous local run
- **THEN** the command does not fail solely because a timing or memory value crossed an implicit or checked-in budget
- **AND** the report retains the values for comparison on equivalent environments

#### Scenario: Correctness failure
- **WHEN** the app fails to launch, the shell does not become ready, output is missing, or renderer drain evidence is incomplete
- **THEN** the report records the failed check and available diagnostics
- **AND** the command exits with a non-zero status

### Requirement: Shared desktop test lifecycle
The system SHALL use the same fixture setup, development-app launcher, readiness checks, driver connection, artifact handling, and cleanup lifecycle for manual sessions and automated scenarios.

#### Scenario: Add another desktop scenario
- **WHEN** a future test supplies a scenario implementation to the desktop test runner
- **THEN** it can use the existing isolated app and seeded repository without duplicating process startup or cleanup code

#### Scenario: Default cleanup
- **WHEN** a manual or automated session ends without a request to retain data
- **THEN** the system stops all child processes and removes generated runtime directories
- **AND** cleanup also runs after launch or scenario failure
