## Purpose

Connect tasks to their GitHub pull requests promptly from verified local activity, while recovering missed associations without depending on frequent global discovery polling.

## ADDED Requirements

### Requirement: Live terminal activity triggers discovery

The system SHALL recognize complete GitHub pull request URLs in live output from a terminal whose authoritative ownership identifies a task and worktree. Recognition SHALL trigger task-scoped verification without waiting for the periodic GitHub discovery cycle, regardless of agent provider or terminal view visibility. Historical replay SHALL NOT trigger discovery.

#### Scenario: Agent prints a new PR URL
- **WHEN** a current task-owned terminal prints a complete GitHub PR URL
- **THEN** the system schedules verification for that task immediately without requiring an agent registration command or a global refresh

#### Scenario: Terminal is not visible
- **WHEN** a task-owned terminal prints a PR URL while its view is hidden or detached, or the app is unfocused
- **THEN** the same event-driven verification occurs while the sidecar is connected to that terminal

#### Scenario: URL spans output chunks
- **WHEN** a valid PR URL is split across consecutive chunks or includes terminal color styling
- **THEN** the system recognizes the complete URL once its terminating boundary is observed
- **AND** it does not treat a partial PR number as a complete URL

#### Scenario: Historical or unattributed output arrives
- **WHEN** output is a replay, belongs to a superseded PTY instance, or has no authoritative task ownership
- **THEN** it does not initiate task PR discovery

### Requirement: Automatic links require repository and branch verification

Before creating an event-driven association, the system SHALL verify through GitHub that the candidate is an open or draft PR for the task's current head repository and worktree branch, including a resolvable tracked upstream branch. The candidate's base repository SHALL be a trusted repository resolved from the task's Git configuration, not an arbitrary repository accepted solely from terminal text. Discovery without a URL SHALL link only an unambiguous matching candidate.

#### Scenario: URL identifies the task's PR
- **WHEN** GitHub confirms that a printed PR URL identifies an open PR with matching repository and branch identity
- **THEN** the system persists the verified PR association using GitHub's canonical PR identity and metadata

#### Scenario: Output mentions an unrelated PR
- **WHEN** output contains a PR URL whose head repository, branch, or base repository does not match the task's resolved Git context
- **THEN** the system does not link that PR

#### Scenario: Fork branch is tracked under another name
- **WHEN** Git configuration identifies the head fork, trusted base repository, and a differently named tracked branch
- **AND** GitHub confirms an open PR for that head identity
- **THEN** the system can link that PR without requiring the local and remote branch names to be identical

#### Scenario: Candidate is ambiguous or no longer open
- **WHEN** branch discovery yields multiple eligible PRs without an exact URL candidate, or the candidate is closed or merged
- **THEN** the event-driven path does not create an association by choosing an arbitrary result

### Requirement: Accepted agent completion triggers bounded fallback discovery

The system SHALL schedule a task-scoped branch lookup after an accepted transition from working to completed or idle for a task implementation agent. Repeated equivalent notifications SHALL be coalesced within a two-second debounce window. Waiting for user input, rejected lifecycle notifications, and non-task review sessions SHALL NOT count as implementation completion.

#### Scenario: Completion occurs without a printed URL
- **WHEN** an accepted agent completion occurs and no URL signal has already satisfied discovery for the same current worktree identity
- **THEN** the system starts branch verification after the two-second debounce, subject to existing request capacity and rate-limit restrictions
- **AND** it can discover the task's first PR even when no PR is already linked

#### Scenario: Completion is duplicated or superseded
- **WHEN** equivalent completion notifications arrive during the debounce, or the agent resumes work before it expires
- **THEN** the system coalesces duplicates and cancels the superseded completion lookup rather than performing one request per notification

### Requirement: Automatic persistence preserves ownership and current identity

The system SHALL revalidate task, worktree, branch, and session identity before committing an asynchronous discovery result. Automatic discovery and reconciliation SHALL NOT transfer an existing PR to another task, remove an existing task PR association, or overwrite a manual association created while verification was in flight. Repeated discovery of the same association SHALL be idempotent.

#### Scenario: Task changes during verification
- **WHEN** verification completes after the task is deleted or completed, its worktree or branch changes, or a different PTY replaces the originating session
- **THEN** the stale result is not persisted

#### Scenario: PR already belongs to another task
- **WHEN** a verified candidate is already associated with another task, including through a concurrent manual link
- **THEN** automatic discovery leaves that association unchanged

#### Scenario: Additional valid PR is discovered
- **WHEN** a task already has a PR and a different unclaimed PR independently passes verification
- **THEN** the system can add the new association without removing the existing one

#### Scenario: Existing association is rediscovered
- **WHEN** terminal, completion, and recovery discovery identify the same PR for the same task
- **THEN** the system retains a single association and does not emit duplicate link-created updates

### Requirement: Verified associations update the UI without another GitHub cycle

After persisting a new verified association, the system SHALL notify task PR consumers so that the PR and related attention state become visible without a manual refresh, terminal remount, or subsequent GitHub polling cycle.

#### Scenario: User is viewing the task
- **WHEN** verification succeeds and the association is committed
- **THEN** the task's PR display and related attention/count consumers refresh from persisted state through the existing event delivery path

### Requirement: Discovery work is bounded and failures are recoverable

The system SHALL bound parser state, pending discovery work, request concurrency, and retry attempts. Detection SHALL NOT block terminal output on GitHub requests. Missing credentials, network failure, and rate limiting SHALL NOT create an unverified link or remove existing links, and SHALL leave the task eligible for later recovery.

#### Scenario: Terminal repeatedly prints the same URL
- **WHEN** repeated output or completion signals arrive while verification is pending or recently succeeded for the same task and repository/branch identity
- **THEN** they share or suppress redundant work instead of producing a request per output occurrence

#### Scenario: Verification temporarily fails
- **WHEN** GitHub is unreachable, credentials are unavailable, or the server imposes a retry delay
- **THEN** terminal output continues normally, existing associations remain intact, and later eligible discovery or reconciliation can retry
- **AND** any deferred request respects the server's retry deadline

#### Scenario: Output exceeds parsing limits or has a gap
- **WHEN** a URL candidate exceeds the bounded parser capacity or its output sequence has a gap
- **THEN** the system discards the incomplete candidate rather than joining unrelated output or growing memory without bound

### Requirement: Slower reconciliation supplements local signals

The system SHALL retain automatic task-link reconciliation with a 5-minute due interval, independent of the existing global review-list refresh cadence. It SHALL perform an initial reconciliation on the first eligible startup cycle, preserve existing focus and rate-limit gates for periodic work, and allow explicit manual synchronization to request reconciliation without waiting for the interval. Existing task-ID matching precedence for recovery SHALL remain branch, then title, then body, with ambiguous matches rejected.

#### Scenario: PR is created outside the observed terminal
- **WHEN** an authored PR has an unambiguous task reference but no local signal was observed
- **THEN** the next eligible recovery reconciliation discovers its association subject to the ownership-preservation requirement

#### Scenario: Global review lists refresh before reconciliation is due
- **WHEN** the global PR lists are due to refresh but task-link reconciliation is not due
- **THEN** the lists refresh without rerunning task-link discovery

#### Scenario: App restarts or user requests synchronization
- **WHEN** the first eligible startup cycle runs or the user requests manual GitHub synchronization
- **THEN** reconciliation is requested without waiting for the 5-minute background interval

### Requirement: Remote PR status polling remains intact

The system SHALL retain existing adaptive polling and explicit refresh behavior for linked PR state, CI, reviews, comments, and merge readiness. Event-driven linking SHALL NOT require a GitHub webhook service or change explicit manual PR linking behavior.

#### Scenario: Reviewer acts outside OpenForge
- **WHEN** a reviewer approves, comments on, or merges a linked PR without producing local terminal output
- **THEN** the existing status polling continues to discover and present that change
