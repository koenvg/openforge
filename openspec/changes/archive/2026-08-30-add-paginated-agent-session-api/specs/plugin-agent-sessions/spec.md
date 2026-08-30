## Purpose

Provide plugins with bounded, provider-scoped Agent Session discovery and the compact Task and workspace context needed to locate or attribute provider-owned history without loading full Task records.

## ADDED Requirements

### Requirement: Plugins can list Agent Sessions across Tasks
The public Plugin SDK SHALL expose a first-class `agentSessions.list()` operation that accepts a provider, a closed-open activity interval, an optional Task ID, an opaque cursor, and a page size from 1 through 250.

#### Scenario: Global provider query
- **WHEN** a plugin lists Agent Sessions for a provider and valid activity interval without a Task ID
- **THEN** the host returns only sessions for that provider whose stored lifetime overlaps the interval, across every Task the plugin can query

#### Scenario: Targeted Task query
- **WHEN** a plugin includes a Task ID in an Agent Session list request
- **THEN** the host returns only matching sessions attributed to that Task without enumerating unrelated Tasks

#### Scenario: Closed-open interval boundaries
- **WHEN** a session ends exactly at `startInclusive`, starts exactly at `endExclusive`, or lies wholly outside the requested interval
- **THEN** the host applies closed-open overlap semantics and excludes sessions that do not overlap `[startInclusive, endExclusive)`

#### Scenario: Active session overlap
- **WHEN** an active session starts before `endExclusive` and has not reached a terminal state
- **THEN** the host treats its lifetime as open-ended and includes it when that lifetime overlaps the requested interval

### Requirement: Session results are compact and attribution-ready
Each listed item SHALL contain the OpenForge Agent Session ID, provider, provider-specific session ID or null, session creation and update timestamps, compact Task identity and presentation metadata, and the Task workspace location or null. The result MUST NOT contain Task prompts, Agent Session checkpoints, error bodies, transcript contents, tool input, or tool output.

#### Scenario: Complete attribution context
- **WHEN** a matching session has a provider-specific identity and Task workspace
- **THEN** its item contains `providerSessionId`, compact Task metadata, and workspace root path and kind without requiring follow-up Task or workspace calls

#### Scenario: Missing provider identity
- **WHEN** a matching Agent Session has no provider-specific session ID
- **THEN** the host returns `providerSessionId: null` and does not infer an identity by scanning the workspace

#### Scenario: Shared workspace
- **WHEN** matching sessions from different Tasks use the same project workspace
- **THEN** each session item retains its own Task attribution and may carry the same workspace context

#### Scenario: Sensitive fields stay excluded
- **WHEN** a Task or Agent Session contains large or sensitive text fields
- **THEN** none of those fields appear anywhere in the Agent Session page payload

### Requirement: Agent Session pagination is bounded and resumable
The host SHALL order matching sessions deterministically, return no more than the requested page size, and return either an opaque `nextCursor` for the following page or null for the final page. A cursor SHALL be valid only with the same provider, interval, and optional Task filter that produced it.

#### Scenario: Multiple stable pages
- **WHEN** matching sessions exceed the requested page size, eligible session records remain unchanged while paging, and the caller passes each returned cursor unchanged with the same filters
- **THEN** the caller receives every matching session once in deterministic order and the final page returns `nextCursor: null`

#### Scenario: Invalid page request
- **WHEN** page size is outside 1 through 250, interval bounds are invalid, or a cursor is malformed or used with different filters
- **THEN** the operation rejects the request with an actionable error and does not return a partial page

### Requirement: Existing task-scoped session listing remains compatible
The existing `tasks.listSessions()` operation SHALL retain its task-scoped request, response, filtering, and newest-first ordering behavior.

#### Scenario: Existing plugin calls remain valid
- **WHEN** a plugin compiled against the existing task-scoped session API calls `tasks.listSessions()` after this capability is released
- **THEN** the call behaves as before without requiring pagination or migration to `agentSessions.list()`

### Requirement: Public SDK and host implementations agree
The published Plugin SDK types, CommonAPIFake, frontend and backend host bridges, and packaged plugin-host runtime SHALL expose the same Agent Session list request and response contract.

#### Scenario: Plugin test fake
- **WHEN** a plugin seeds Agent Sessions, Tasks, and workspaces in CommonAPIFake and calls `agentSessions.list()`
- **THEN** the fake applies provider, interval, Task, cursor, compact-payload, and page-size behavior consistent with the host contract

#### Scenario: Packaged runtime
- **WHEN** a packaged backend plugin calls `agentSessions.list()`
- **THEN** the plugin-host runtime routes the request through the identity-aware host callback and returns the typed compact page