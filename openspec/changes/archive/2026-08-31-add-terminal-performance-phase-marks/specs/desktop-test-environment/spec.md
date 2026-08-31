## Purpose

Provides actionable full-app terminal timing evidence without changing terminal scheduling or mixing automation setup with steady-state measurements.

## ADDED Requirements

### Requirement: Explicit shell-readiness phase timeline
The system SHALL retain the existing full-app shell-readiness end-to-end duration and SHALL also report monotonic timestamps for lifecycle start, terminal attachment, xterm mount, shell spawn request, PTY creation, input acceptance, first output, model publication, xterm parse, render callback, and presentation proof.

The declared phase order SHALL follow the existing terminal lifecycle: lifecycle start, terminal attachment, xterm mount, shell spawn request, PTY creation, input acceptance, first output, model publication, xterm parse, render callback, and presentation proof. Instrumentation SHALL NOT reorder lifecycle work to match a reporting model.

#### Scenario: Complete shell-readiness timeline
- **WHEN** the automated scenario opens the seeded task terminal and proves that the readiness marker was presented
- **THEN** the report contains a finite monotonic timestamp for every declared phase
- **AND** the timestamps follow the declared lifecycle order
- **AND** the existing shell-readiness end-to-end duration remains present

#### Scenario: Missing phase observation
- **WHEN** a phase cannot be observed before the shell-readiness measurement completes
- **THEN** the report represents that phase and every dependent segment as unavailable rather than zero
- **AND** the report identifies the missing phase in correctness diagnostics

#### Scenario: Out-of-order phase observation
- **WHEN** a recorded phase timestamp precedes a required earlier phase
- **THEN** the phase-ordering correctness check fails
- **AND** the report retains the raw timestamps for diagnosis

### Requirement: Actionable phase segments
The system SHALL derive and report a duration for each adjacent pair in the declared phase order using one renderer monotonic clock domain. Each segment SHALL identify its start phase, end phase, duration, unit, and availability.

#### Scenario: Segment report generation
- **WHEN** all phase timestamps are available and ordered
- **THEN** the machine-readable report contains every adjacent phase segment
- **AND** the console summary reports each segment alongside the preserved end-to-end shell-readiness duration

#### Scenario: Cross-process work
- **WHEN** a phase includes backend work such as PTY creation
- **THEN** the segment uses renderer-observed request and completion marks from the same monotonic clock domain
- **AND** the report does not compare unsynchronized browser, Node, and sidecar monotonic timestamps

### Requirement: Already-focused echo measurement
The steady-state echo distribution SHALL focus Shell 1 once before warm-up and SHALL send every warm-up and measured sample through an already-focused input path that does not click the shell tab.

#### Scenario: Warm-up and measured focused samples
- **WHEN** the scenario begins steady-state echo sampling
- **THEN** it focuses Shell 1 once before the first warm-up sample
- **AND** no warm-up or measured focused sample clicks Shell 1
- **AND** the report identifies the distribution as already-focused

#### Scenario: Focused sample correctness
- **WHEN** an already-focused echo sample completes
- **THEN** it is subject to the same completion-marker, sequence-continuity, expected-byte, and presentation-proof checks as a full-driver sample

### Requirement: Separate full-driver echo measurement
The automated scenario SHALL retain a separate focus-and-type measurement that exercises the normal browser-driver path and SHALL report it separately from the already-focused distribution.

#### Scenario: Full-driver automation coverage
- **WHEN** the scenario records its full-driver echo measurement
- **THEN** the driver focuses Shell 1 through the visible application control before typing
- **AND** the result is not included in the already-focused median or p95
- **AND** the same correctness checks used for focused samples apply

### Requirement: Passive opt-in profiling
Performance marks SHALL be collected only for an explicitly enabled development desktop-test session. Mark collection SHALL observe existing lifecycle callbacks without introducing waits, new scheduling boundaries, or production-side timing work.

#### Scenario: Profiling enabled
- **WHEN** the development desktop-test probe enables a terminal performance trace
- **THEN** lifecycle and presentation callbacks record their first applicable monotonic phase marks
- **AND** the probe exposes only serializable marks and derived evidence

#### Scenario: Profiling disabled
- **WHEN** the application runs without an active terminal performance trace
- **THEN** phase sites do not read the monotonic clock or retain trace data
- **AND** normal terminal behavior remains unchanged

#### Scenario: Profiler-off overhead verification
- **WHEN** the profiler-off terminal workload is compared with the equivalent uninstrumented workload on the same runtime
- **THEN** median overhead is below 2 percent
- **AND** the verification retains its raw samples and comparison method
