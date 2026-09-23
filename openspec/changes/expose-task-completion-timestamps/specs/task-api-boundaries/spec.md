## MODIFIED Requirements

### Requirement: Canonical Task projections
The system SHALL expose `TaskReference`, `TaskSummary`, and `TaskDetail` as the only canonical Task read projections. Public projection and request fields SHALL use camelCase through every new adapter. `TaskSummary` and `TaskDetail` SHALL expose `completedAt` as Unix seconds or null. Null SHALL mean not completed for active tasks and unknown completion time for done tasks.

#### Scenario: Completed Task page returns summaries
- **WHEN** a caller reads Completed Tasks
- **THEN** every returned item SHALL conform to `TaskSummary`
- **AND** no returned item SHALL contain the canonical prompt or an internal execution prompt
- **AND** each item SHALL include its completion timestamp or explicit null

#### Scenario: Related Task uses a reference
- **WHEN** the system returns a Task solely to render an immediate dependency or dependent relationship
- **THEN** it SHALL return a `TaskReference`
- **AND** the reference SHALL contain enough identity, project, state, title, and dependency information to render and open that Task

#### Scenario: Caller requests full Task data
- **WHEN** a caller reads one Task through the canonical detail intent
- **THEN** the Task SHALL conform to `TaskDetail`
- **AND** its completion date SHALL agree with its summary

### Requirement: Bounded active Task set
A project SHALL contain at most 500 non-Completed Tasks. Creation or status changes that would exceed that limit SHALL fail atomically with the same typed limit error through every adapter. Completed Tasks SHALL NOT be restored to active states, regardless of available capacity.

#### Scenario: Project reaches the active limit
- **WHEN** a project already contains 500 non-Completed Tasks
- **AND** a caller attempts to create another non-Completed Task
- **THEN** the operation SHALL fail without creating the Task
- **AND** the existing Tasks SHALL remain unchanged

#### Scenario: Caller attempts to reopen a Completed Task
- **WHEN** a caller attempts to change a Completed Task to a non-Completed state
- **THEN** the operation SHALL fail with a terminal-state error regardless of the project's active count
- **AND** the Task state and completion date SHALL remain unchanged

#### Scenario: Completed Task becomes active at the limit
- **WHEN** a project already contains 500 non-Completed Tasks
- **AND** a caller attempts to change a Completed Task to a non-Completed state
- **THEN** the operation SHALL fail with a terminal-state error without changing the Task state or completion timestamp

### Requirement: Fixed Completed Task pagination
The completed intent SHALL return at most 50 `TaskSummary` records per page. Callers SHALL NOT supply a status, project scope override, or page-size control. Without a date range, pages SHALL retain deterministic `updatedAt DESC, id DESC` keyset ordering. With `completedFrom` and `completedBefore`, pages SHALL use `completedAt DESC, id DESC` keyset ordering and include only known dates in that half-open Unix-second interval. Both range endpoints SHALL be supplied together as nonnegative safe integers with `completedFrom < completedBefore`. Every page SHALL include completion coverage metadata independent of its cursor position.

#### Scenario: Caller reads the first Completed Task page
- **WHEN** a caller submits a project with optional text and Task Label filters but no cursor
- **THEN** the system SHALL return at most 50 matching Completed Tasks
- **AND** it SHALL omit full prompts

#### Scenario: Caller reads the next Completed Task page
- **WHEN** a page has a continuation cursor and the caller submits it with the same project and filters
- **THEN** the system SHALL return the next deterministically ordered page
- **AND** unchanged data SHALL not repeat an item from the previous page

#### Scenario: Caller submits an invalid cursor
- **WHEN** a cursor is malformed or does not match the requested project, normalized filters, date range, or ordering mode
- **THEN** every adapter SHALL return the same typed cursor error

#### Scenario: Caller submits bounded filters
- **WHEN** a caller submits a text query of at most 200 Unicode characters and at most 20 Task Label names of at most 40 Unicode characters each after trimming
- **THEN** the system SHALL apply those filters to Completed Task summaries
- **AND** ASCII search SHALL be case-insensitive while non-ASCII casing remains exact

#### Scenario: Caller submits excessive filters
- **WHEN** a text query or Task Label filter exceeds a documented bound
- **THEN** every adapter SHALL return the same typed validation error

#### Scenario: Caller submits a date range
- **WHEN** a caller requests a valid completion range
- **THEN** dates equal to the lower bound SHALL be included and dates equal to the upper bound SHALL be excluded
- **AND** unknown dates SHALL be excluded from matches but represented in coverage metadata

#### Scenario: Caller submits invalid dates
- **WHEN** either endpoint is missing, fractional, negative, non-finite, unsafe, equal to the other endpoint, or the lower endpoint exceeds the upper endpoint
- **THEN** every adapter SHALL reject the query with the same typed range-validation error

#### Scenario: Metadata updates between period pages
- **WHEN** metadata changes between page reads without changing membership in the requested filters
- **THEN** completion-date pagination SHALL neither skip nor duplicate those tasks because of their changed update dates
