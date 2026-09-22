## Purpose

Keep pull-request feedback timely by reserving macOS runners for checks that need native Apple behavior, while preserving complete native validation and trustworthy required-check results.

## ADDED Requirements

### Requirement: Supported macOS runner baseline

Every ARM macOS CI, packaging, and release job SHALL use an explicitly versioned runner image that GitHub supports. Native packaging checks SHALL continue to verify the expected host and Node architecture and SHALL reject translated execution where that evidence is part of the existing contract.

#### Scenario: ARM macOS job starts
- **WHEN** a pull-request, scheduled, manual, or release workflow requests an ARM macOS runner
- **THEN** the job uses the supported macOS 15 ARM image
- **AND** the workflow contains no `macos-14` runner reference

#### Scenario: Native package architecture is wrong
- **WHEN** a packaged-runtime job runs on a host or Node architecture that does not match its declared target, or detects translated execution
- **THEN** the job fails before treating package or lifecycle evidence as valid

### Requirement: Bounded routine pull-request demand

Pull-request CI SHALL reserve macOS capacity for checks whose behavior depends on native macOS execution. A pull request outside the declared packaged-session, mobile, Ghostty, and Whisper impact sets SHALL request no more than four macOS jobs while retaining Rust validation, broad ARM packaged-app smoke, and live Electron terminal invariants.

#### Scenario: Pull request has no optional native impact
- **WHEN** a pull request changes no declared input for packaged-session runtime, iOS build, macOS Ghostty compatibility, or Whisper compatibility
- **THEN** CI does not allocate macOS runners for those optional checks
- **AND** the pull request still runs Rust validation, packaged Electron smoke, and live Electron terminal invariants on macOS
- **AND** the complete pull request requests at most four macOS jobs

#### Scenario: Pull request affects one native area
- **WHEN** a pull request changes a declared input for an optional native check
- **THEN** CI schedules every platform and architecture entry required by that check
- **AND** unaffected optional native checks remain unallocated

### Requirement: Fail-closed affected-area selection

Affected-area selection SHALL derive optional native execution from a reviewable mapping of path inputs to check families. The selector SHALL treat incomplete revision data, classification errors, shared native build inputs, dependency locks, and its own workflow or mapping changes as affected rather than silently skipping native coverage.

#### Scenario: Changed paths are classified
- **WHEN** CI can compare the pull request or push revisions and every changed path has a deterministic classification
- **THEN** it publishes the affected state for each optional native check
- **AND** downstream jobs use that state without allocating a macOS runner merely to discover that they are unaffected

#### Scenario: Classification is uncertain
- **WHEN** revision data is missing, the classifier fails, or a changed path can affect native builds but has no narrower safe classification
- **THEN** every optional native check that could be affected runs
- **AND** CI does not report the uncertain classification as an intentional skip

### Requirement: Recurring and operator-invoked native coverage

Optional native checks SHALL remain available as complete manual runs and SHALL have a daily scheduled full run independent of changed-path selection. Scheduled and manual execution SHALL preserve the same assertions, native architecture matrix, artifacts, and failure behavior as affected pull-request execution.

#### Scenario: Daily full validation starts
- **WHEN** the scheduled native validation trigger runs
- **THEN** packaged-session ARM and Intel checks, iOS build, macOS Ghostty compatibility, and scoped Whisper compatibility run regardless of recent changed paths

#### Scenario: Operator requests full validation
- **WHEN** an operator dispatches a native workflow without a change filter
- **THEN** every matrix entry owned by that workflow runs and publishes its normal evidence

### Requirement: Canonical Linux terminal visual conformance

Terminal presentation and Markdown browser visual conformance SHALL run in a pinned Linux environment against reviewed Linux baselines. The Linux job SHALL retain the existing semantic, interaction, readiness, repeatability, pixel-tolerance, blank-output, diagnostic, and failure-artifact behavior.

#### Scenario: Browser conformance passes
- **WHEN** the Linux terminal presentation job runs against unchanged rendering behavior
- **THEN** it compares every declared screenshot with the approved Linux baseline
- **AND** it runs every existing semantic and interaction assertion
- **AND** it uploads its report and screenshots

#### Scenario: Linux baseline inventory is invalid
- **WHEN** an approved baseline is missing, obsolete, or differs beyond the existing tolerance
- **THEN** browser conformance fails and retains the current and difference evidence

#### Scenario: Native PTY assertion remains covered
- **WHEN** terminal browser conformance moves off macOS
- **THEN** the macOS Rust suite continues to run the live PTY color-profile assertion
- **AND** the Linux visual job does not duplicate that native Rust invocation

### Requirement: Compatible status and measurement evidence

Runner-allocation changes SHALL preserve existing required-check identities where possible. Any identity change SHALL be mapped and approved before rollout. CI evidence SHALL distinguish executed, intentionally skipped, cancelled, and missing checks and SHALL report workflow wall time, queue time, macOS job count, and macOS runner time for complete comparison runs.

#### Scenario: Optional check is unaffected
- **WHEN** affected-area selection intentionally skips an optional native check
- **THEN** the pull request receives an explicit non-failing status that identifies the check as not required for that revision
- **AND** reporting does not count the check as executed coverage

#### Scenario: Required status would change
- **WHEN** splitting a matrix or moving a job changes a status-check identity
- **THEN** rollout stops until the old and new identities are mapped and the repository owner approves any branch-protection migration

#### Scenario: Before-and-after runs are compared
- **WHEN** complete runs before and after the allocation change are evaluated
- **THEN** the report states queue delay and runner consumption separately from workflow wall time
- **AND** it records runner labels and which optional checks executed
