## Purpose

Populate newly linked task pull requests promptly with available GitHub details, and distinguish incomplete retrieval from GitHub's actual review and merge readiness state.

## ADDED Requirements

### Requirement: Linking initiates view-independent detail retrieval

After a new task PR association is persisted, the system SHALL expose the association immediately and schedule targeted detail retrieval without waiting for a periodic GitHub cycle. This SHALL apply to automatic discovery, manual linking, and recovery reconciliation, independent of task selection, panel mounting, and application focus. Existing association verification and ownership rules SHALL remain unchanged.

#### Scenario: Automatically discovered PR becomes visible
- **WHEN** a verified PR is newly associated with a task
- **THEN** its available basic metadata becomes visible before detail retrieval completes
- **AND** detail retrieval starts subject to shared request capacity and rate-limit restrictions, without a manual refresh or periodic poll

#### Scenario: Manual link or recovery association
- **WHEN** manual linking or reconciliation creates a task PR association
- **THEN** the same detail retrieval behavior applies
- **AND** a failed detail fetch does not remove the association or fabricate verified metadata

#### Scenario: Task panel is absent
- **WHEN** a PR is linked while its task is hidden or the app is unfocused
- **THEN** retrieval still runs and persists results for the next view of that task

### Requirement: Hydration covers the existing PR detail set

The system SHALL retrieve and persist canonical PR metadata, lifecycle state, head revision, CI checks and statuses, reviews and requested reviewers, comments, and merge-readiness inputs used by the existing task PR display. Successful empty results SHALL be distinguished from failed or unattempted retrieval. Retrieval SHALL NOT grant merge eligibility when GitHub or required policy inputs remain unknown.

#### Scenario: Full retrieval succeeds
- **WHEN** the required detail sources return successfully for the current PR revision
- **THEN** the task PR display presents the retrieved data without another GitHub cycle
- **AND** a hydration-state transition is delivered even if CI and review summary values did not change

#### Scenario: PR has no checks or reviewers
- **WHEN** GitHub successfully returns empty checks, reviews, requested reviewers, or comments
- **THEN** those empty results count as fetched data rather than triggering retries for absent content

#### Scenario: One source fails
- **WHEN** some detail sources succeed and another fails
- **THEN** successful results remain available, the detail fetch is not reported as complete, and missing data is not replaced by a successful empty result

### Requirement: Fetch status is distinct from merge readiness

The task PR display SHALL distinguish pending or active initial retrieval, incomplete or failed retrieval, and successfully retrieved details. During initial retrieval it SHALL show "Fetching details..." while retaining the PR link and available metadata. Failed or deferred retrieval SHALL present a non-blocking explanation and retain access to manual refresh. A successfully fetched but unresolved GitHub readiness value SHALL remain "Readiness Unknown", not a claim of readiness or a perpetual loading indicator.

#### Scenario: First fetch is pending
- **WHEN** a linked PR has not completed its initial detail retrieval
- **THEN** the card indicates fetching or a known deferred/failure reason rather than showing only "Readiness Unknown"
- **AND** the PR URL remains usable

#### Scenario: GitHub has not calculated mergeability
- **WHEN** required requests succeed but GitHub still reports unknown mergeability
- **THEN** the system does not label this a network failure or grant merge eligibility
- **AND** after bounded follow-up attempts the display remains "Readiness Unknown" and normal polling continues

#### Scenario: Refresh fails after data was available
- **WHEN** a subsequent detail refresh fails
- **THEN** previously retrieved details remain visible with a non-blocking stale or error indication

### Requirement: Automatic hydration work is bounded and recoverable

The system SHALL coalesce duplicate hydration requests for the same PR association, bound concurrent and pending work, and allow at most two delayed retries per automatic hydration episode after its initial attempt. Automatic requests SHALL honor server retry/reset deadlines and SHALL NOT clear shared rate-limit state to force a fetch. Authentication and permanent access failures SHALL end the episode without repeated automatic requests. Manual refresh and subsequent eligible background synchronization SHALL remain recovery paths.

#### Scenario: Duplicate signals and concurrent polling
- **WHEN** repeated link signals, manual refresh, or background polling request the same PR while hydration is running
- **THEN** redundant work is coalesced or serialized without parallel conflicting writes or an event-triggered refresh loop

#### Scenario: Transient failure or delayed visibility
- **WHEN** a request times out, returns a retryable server failure, or a just-linked PR is temporarily not visible
- **THEN** automatic hydration performs only the bounded retry episode and retains successful data
- **AND** exhaustion leaves an explicit recoverable state rather than indefinite fetching

#### Scenario: Rate limit or authentication failure
- **WHEN** GitHub reports a rate limit or missing/invalid credentials
- **THEN** the display explains the deferred or unavailable fetch
- **AND** automatic requests do not bypass the rate-limit deadline or repeatedly retry invalid credentials

#### Scenario: Restart interrupts initial retrieval
- **WHEN** the app restarts with an unfinished initial fetch
- **THEN** eligible hydration resumes through bounded backend recovery without requiring a task panel to mount

### Requirement: Results belong to the current PR association and revision

Asynchronous hydration SHALL NOT apply results to a deleted or reassigned association, mix status from different head revisions, or let older work overwrite newer completed work. Synthetic manual-link identity reconciliation SHALL preserve one logical association and its fetch state.

#### Scenario: Association changes while fetching
- **WHEN** the PR is unlinked, reassigned, or its task is deleted before retrieval completes
- **THEN** the outdated operation does not restore the old association or update the wrong task

#### Scenario: PR head advances
- **WHEN** a PR head changes during detail retrieval
- **THEN** old-revision checks and readiness are not published as current
- **AND** retrieval for the current revision remains eligible

#### Scenario: Manual link receives canonical identity
- **WHEN** a manually linked PR obtains canonical GitHub identity
- **THEN** its hydrated details update the same logical task association without a duplicate card
