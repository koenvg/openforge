## Purpose

Defines a bounded, project-scoped Task read contract that keeps Focus selection synchronous, Completed Task history paginated, relationship context complete, and every transport adapter behaviorally aligned.

## ADDED Requirements

### Requirement: Canonical Task projections
The system SHALL expose `TaskReference`, `TaskSummary`, and `TaskDetail` as the only canonical Task read projections. Public projection and request fields SHALL use camelCase through every new adapter.

#### Scenario: Completed Task page returns summaries
- **WHEN** a caller reads Completed Tasks
- **THEN** every returned item SHALL conform to `TaskSummary`
- **AND** no returned item SHALL contain the canonical prompt or an internal execution prompt

#### Scenario: Related Task uses a reference
- **WHEN** the system returns a Task solely to render an immediate dependency or dependent relationship
- **THEN** it SHALL return a `TaskReference`
- **AND** the reference SHALL contain enough identity, project, state, title, and dependency information to render and open that Task

#### Scenario: Caller requests full Task data
- **WHEN** a caller reads one Task through the canonical detail intent
- **THEN** the Task SHALL conform to `TaskDetail`

### Requirement: Three canonical Task read intents
The system SHALL expose exactly three canonical Task read intents: `active(projectId)`, `completed(projectId, query?)`, and `detail(projectId, taskId)`. Desktop IPC, HTTP, CLI, frontend plugin host, backend plugin host, plugin SDK, and in-memory test adapters SHALL preserve the same request semantics and result projections.

#### Scenario: Caller reads active Tasks
- **WHEN** a caller submits `active` for an existing project
- **THEN** the result SHALL contain every non-Completed `TaskDetail` in that project
- **AND** it SHALL contain the compact references needed to render their immediate relationships
- **AND** it SHALL contain no Task from another project except those relationship references

#### Scenario: Caller reads Completed Tasks
- **WHEN** a caller submits `completed` for an existing project
- **THEN** the result SHALL contain only Completed `TaskSummary` records from that project
- **AND** it SHALL contain a continuation cursor when another page exists

#### Scenario: Caller reads one Task
- **WHEN** a caller submits `detail` with a project and Task ID
- **THEN** the result SHALL contain that `TaskDetail` and its immediate relationship references when the Task belongs to the project
- **AND** the result SHALL be null when that project does not contain the Task

#### Scenario: Caller submits a missing project
- **WHEN** a canonical read names a project that does not exist
- **THEN** every adapter SHALL return the same typed project-not-found error

### Requirement: One canonical Task prompt
`TaskDetail.prompt` SHALL represent the user-authored Task prompt. Agent Session and Implementation Run prompt composition SHALL remain internal and SHALL NOT mutate this field.

#### Scenario: Detail prompt is displayed and edited
- **WHEN** a caller reads or edits the prompt through the canonical Task detail contract
- **THEN** it SHALL read or change the same canonical prompt displayed in Task detail

#### Scenario: Implementation Run prompt is composed
- **WHEN** an Implementation Run starts for a Task
- **THEN** the system MAY add configured contributions and start-time instructions internally
- **AND** those additions SHALL NOT replace or mutate `TaskDetail.prompt`

### Requirement: Bounded active Task set
A project SHALL contain at most 500 non-Completed Tasks. Creation, restoration, or status changes that would exceed that limit SHALL fail atomically with the same typed limit error through every adapter.

#### Scenario: Project reaches the active limit
- **WHEN** a project already contains 500 non-Completed Tasks
- **AND** a caller attempts to create or restore another non-Completed Task
- **THEN** the operation SHALL fail without creating or restoring the Task
- **AND** the existing Tasks SHALL remain unchanged

#### Scenario: Completed Task becomes active at the limit
- **WHEN** a project already contains 500 non-Completed Tasks
- **AND** a caller attempts to change a Completed Task to a non-Completed state
- **THEN** the operation SHALL fail without changing the Task state

### Requirement: Bounded direct relationships
A Task SHALL have at most 100 direct relationships in total, counting its direct dependencies and direct dependents. A relationship write that would make either Task exceed the limit SHALL fail atomically with the same typed limit error through every adapter.

#### Scenario: Relationship reaches either Task limit
- **WHEN** a caller adds a dependency relationship
- **AND** the relationship would give either participating Task more than 100 direct relationships
- **THEN** the operation SHALL fail without creating the relationship
- **AND** both Tasks' existing relationships SHALL remain unchanged

#### Scenario: Existing relationship is submitted again
- **WHEN** a caller submits a relationship that already exists
- **THEN** the operation SHALL preserve idempotent behavior
- **AND** it SHALL NOT consume another relationship slot

### Requirement: Selection-ready active result
The active result SHALL contain complete details for its bounded non-Completed Task set so Focus selection needs no follow-up Task read.

#### Scenario: User changes Focus selection
- **WHEN** the active result has loaded and the user selects another Task from that result
- **THEN** Task detail SHALL render from in-memory data
- **AND** selection SHALL NOT initiate another Task read
- **AND** no Task loading placeholder SHALL replace the visible detail

#### Scenario: Task-scoped plugin UI mounts
- **WHEN** task-scoped frontend plugin UI mounts for a Task in the active result
- **THEN** the host SHALL provide that cached `TaskDetail`
- **AND** the plugin SHALL NOT need a detail read for ordinary Task fields during mount

### Requirement: Atomic active refresh
The client SHALL replace active Task state atomically and SHALL keep concurrency tokens inside the implementation rather than accepting a caller-provided revision.

#### Scenario: Refresh completes out of order
- **WHEN** two active refreshes complete out of order
- **THEN** the client SHALL keep or apply only the newest valid result for the Selected Project
- **AND** an older result SHALL NOT overwrite newer visible Task data

#### Scenario: Same-project refresh is in progress
- **WHEN** a loaded Selected Project refreshes its active Tasks
- **THEN** existing Focus cards and Task detail SHALL remain visible until the complete replacement is ready

#### Scenario: Uncached project switch starts
- **WHEN** the user switches to a project without cached active data
- **THEN** Tasks from the previous project SHALL be detached before the new project read begins
- **AND** a failed read SHALL NOT leave previous-project Tasks visible under the new Selected Project

### Requirement: Fixed Completed Task pagination
The completed intent SHALL return at most 50 `TaskSummary` records per page. Callers SHALL NOT supply a status, project scope override, or page-size control. Pages SHALL use deterministic `updatedAt DESC, id DESC` keyset ordering.

#### Scenario: Caller reads the first Completed Task page
- **WHEN** a caller submits a project with optional text and Task Label filters but no cursor
- **THEN** the system SHALL return at most 50 matching Completed Tasks
- **AND** it SHALL omit full prompts

#### Scenario: Caller reads the next Completed Task page
- **WHEN** a page has a continuation cursor and the caller submits it with the same project and filters
- **THEN** the system SHALL return the next deterministically ordered page
- **AND** unchanged data SHALL not repeat an item from the previous page

#### Scenario: Caller submits an invalid cursor
- **WHEN** a cursor is malformed or does not match the requested project and normalized filters
- **THEN** every adapter SHALL return the same typed cursor error

#### Scenario: Caller submits bounded filters
- **WHEN** a caller submits a text query of at most 200 Unicode characters and at most 20 Task Label names of at most 40 Unicode characters each after trimming
- **THEN** the system SHALL apply those filters to Completed Task summaries
- **AND** ASCII search SHALL be case-insensitive while non-ASCII casing remains exact

#### Scenario: Caller submits excessive filters
- **WHEN** a text query or Task Label filter exceeds a documented bound
- **THEN** every adapter SHALL return the same typed validation error

### Requirement: Bounded on-demand detail state
The renderer SHALL retain at most 20 on-demand full `TaskDetail` records for Completed or linked Tasks. Active Task details SHALL remain owned by the current project result rather than consuming this limit.

#### Scenario: User opens a Completed Task
- **WHEN** the user opens a `TaskSummary` that is absent from active data
- **THEN** the renderer SHALL load it through `detail`
- **AND** the same result SHALL provide its immediate relationship references

#### Scenario: Detail cache exceeds its limit
- **WHEN** storing an on-demand detail would retain more than 20 entries
- **THEN** the least-recently-used on-demand detail and its relationship context SHALL be evicted

#### Scenario: Detail refresh completes out of order
- **WHEN** concurrent refreshes for the same on-demand Task complete out of order
- **THEN** only the newest result that still matches the Selected Project and selected Task SHALL become visible

### Requirement: Aligned adapter behavior
Canonical Task read adapters SHALL share projection fields, camelCase naming, defaults, filter normalization, cursor ordering, null behavior, validation, and typed errors. Transport adapters SHALL only encode or decode their transport.

#### Scenario: Frontend and backend plugins submit the same read
- **WHEN** frontend and backend plugins submit equivalent canonical Task reads
- **THEN** both hosts SHALL return behaviorally equivalent results
- **AND** they SHALL apply the same errors and bounds

#### Scenario: In-memory adapter runs contract cases
- **WHEN** the canonical Task read contract suite runs against the in-memory adapter
- **THEN** its observable results SHALL match the Rust production adapter
- **AND** tests SHALL treat cursors as opaque

### Requirement: Isolated deprecated compatibility
Published legacy `list()` and `get()` reads SHALL remain available through compatibility adapters until version 2. Compatibility adapters SHALL preserve documented legacy results exactly and SHALL NOT be used by first-party implementation code.

#### Scenario: Version 1 plugin lists legacy Tasks
- **WHEN** a version 1 plugin calls deprecated `list()`
- **THEN** the host SHALL preserve the documented complete legacy array behavior
- **AND** it SHALL NOT silently cap or page the result
- **AND** the host SHALL emit at most one deprecation warning per plugin activation

#### Scenario: Version 1 plugin reads one legacy Task
- **WHEN** a version 1 plugin calls deprecated `get()`
- **THEN** the compatibility adapter SHALL preserve the documented legacy projection and missing-Task behavior

#### Scenario: First-party caller reads Tasks
- **WHEN** desktop, bundled plugin, or other first-party code reads Tasks
- **THEN** it SHALL use `active`, `completed`, or `detail`
- **AND** it SHALL NOT call the compatibility adapters

#### Scenario: Version 2 removes compatibility
- **WHEN** a caller targets plugin or HTTP contract version 2
- **THEN** deprecated `list()` and `get()` SHALL NOT be present

### Requirement: Bounded command-line Task reads
The CLI SHALL expose project-scoped active, Completed Task, and detail commands with the same canonical projections and bounds. Legacy broad commands MAY remain only as documented deprecated compatibility commands.

#### Scenario: Agent scans Completed Tasks
- **WHEN** an agent requests Completed Tasks through the CLI
- **THEN** the CLI SHALL return at most 50 summaries and a continuation cursor
- **AND** it SHALL NOT emit full prompts

#### Scenario: Agent reads one Task
- **WHEN** an agent requests canonical Task detail through the CLI
- **THEN** the CLI SHALL return the `TaskDetail` and immediate relationship references

### Requirement: Narrow internal Task reads
Internal callers that need identifiers, Task Attention, relationships, or one Task SHALL use intent-specific persistence reads and SHALL NOT hydrate every Task or Completed Task prompt.

#### Scenario: Internal caller resolves Task relationships
- **WHEN** an internal caller needs immediate dependency or dependent context
- **THEN** it SHALL query only the required references and edges
- **AND** it SHALL NOT load unrelated Completed Task details

#### Scenario: Task Attention renders navigation references
- **WHEN** Task Attention provides Task navigation
- **THEN** it SHALL derive compact references from its lane projection
- **AND** it SHALL NOT load a full active result for every project
