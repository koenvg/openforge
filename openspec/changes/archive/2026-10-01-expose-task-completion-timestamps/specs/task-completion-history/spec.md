## Purpose

Provide authoritative task completion dates and explicit historical coverage so plugins can count completed work over time without guessing dates.

## ADDED Requirements

### Requirement: Terminal completion is recorded once
The system SHALL persist the first successful task completion instant atomically with its transition from doing to done. Completed tasks SHALL be terminal and SHALL NOT be reopened. Agent-run completion, backlog deletion, and failed lifecycle operations SHALL NOT count as task completion.

#### Scenario: Task completes successfully
- **WHEN** a supported completion entry point successfully completes a doing task
- **THEN** the task SHALL become done and retain its authoritative completion timestamp across restart
- **AND** its task ID and project ID SHALL identify one completion record

#### Scenario: Completion fails or repeats
- **WHEN** completion fails, loses a lifecycle race, or is requested again for a done task
- **THEN** no new completion record SHALL be created
- **AND** any existing completion timestamp SHALL remain unchanged, including an unknown historical timestamp

#### Scenario: Metadata changes after completion
- **WHEN** a completed task's title, labels, or other metadata changes
- **THEN** its completion timestamp SHALL remain unchanged

#### Scenario: Completed task cannot reopen
- **WHEN** a caller attempts to move a done task to backlog or doing
- **THEN** the operation SHALL fail without changing its state or completion timestamp

### Requirement: Honest historical dates
Migration SHALL preserve independently verified task completion timestamps where available. It SHALL NOT infer completion from creation, modification, agent-session completion, token activity, or first observation. Unrecoverable completion timestamps SHALL remain null.

#### Scenario: Legacy history lacks evidence
- **WHEN** a legacy done task has only created and updated dates
- **THEN** migration SHALL leave its completion date null
- **AND** later metadata writes and repeated migration or schema repair SHALL NOT assign a completion date

#### Scenario: Verified date already exists
- **WHEN** schema repair or migration encounters a verified persisted task completion date
- **THEN** it SHALL preserve that date without replacing it with migration time

### Requirement: Coverage accompanies bounded history
Every completed-task page SHALL include coverage metadata, including empty pages. Coverage SHALL identify when continuous authoritative tracking began and how many retained completed tasks have unknown dates within the project and non-date filters. Unknown dates SHALL NOT be assigned to any requested period. Coverage SHALL NOT claim complete pre-tracking history merely because no retained unknown rows exist.

#### Scenario: Empty covered period
- **WHEN** a period lies wholly within continuous tracking coverage and contains no matching completions
- **THEN** the result SHALL identify complete coverage and zero matching records

#### Scenario: Empty historical period
- **WHEN** a period extends before verified continuous tracking began
- **THEN** the result SHALL identify partial or unavailable coverage even if its records are empty
- **AND** unknown historical completions SHALL be reported separately from dated matches

### Requirement: Published SDK supports completion analytics
The public SDK SHALL expose completion dates, range queries, coverage metadata, task IDs, and project IDs in its built package declarations and supported plugin entry points. Documentation SHALL define null semantics, timestamp units, coverage limits, and local-calendar querying.

#### Scenario: Consumer counts a local-calendar period
- **WHEN** a plugin converts its local period boundaries to Unix seconds and reads every page for that half-open interval
- **THEN** it SHALL be able to count known completions and join their task IDs to its own usage index
- **AND** coverage SHALL indicate whether that count represents complete history or only known records

#### Scenario: Consumer installs the released SDK
- **WHEN** a plugin typechecks against the released package rather than repository source
- **THEN** the completion contract SHALL be available without private host types
