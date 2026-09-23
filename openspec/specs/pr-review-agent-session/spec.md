# pr-review-agent-session Specification

## Purpose

Let a pull request reviewer watch the Project's configured agent work at the current head, receive its walkthrough and review comments as they are submitted, and continue the same conversation with follow-up questions.

## Requirements

### Requirement: Pull request review sessions share the Review Thread address
The GitHub Sync plugin SHALL derive one Session Scope for a pull request from namespace `github`, target key `gh:<owner>/<repo>#<number>`, and revision equal to the pull request head SHA. It SHALL use that exact triple for the pull request's Scoped Agent Session and Review Threads. A different target key or head SHA MUST address a different session.

#### Scenario: Session and threads address the same pull request head
- **WHEN** a reviewer opens the agent session and Review Threads for pull request 42 in `acme/web` at head `abc123`
- **THEN** both use namespace `github`, target key `gh:acme/web#42`, and revision `abc123`

#### Scenario: Pull request head changes
- **WHEN** the same pull request moves from head `abc123` to head `def456`
- **THEN** the plugin addresses a new session and thread set at revision `def456`
- **AND** it does not continue the session for `abc123`

### Requirement: The Agent tab is a stable pull request detail tab
Every pull request detail view SHALL show an Agent tab whether or not a session or walkthrough exists. The tab SHALL remain addressable at one stable keyboard position while the Walkthrough tab remains conditional on an available walkthrough. When no local Project can supply the repository checkout, the Agent tab SHALL explain why a session cannot start instead of disappearing.

#### Scenario: Pull request has no session yet
- **WHEN** a reviewer opens a pull request whose current head has no Scoped Agent Session
- **THEN** the pull request detail still shows the Agent tab with the action or explanation appropriate to that repository

#### Scenario: Walkthrough becomes available
- **WHEN** the first accepted walkthrough step makes the conditional Walkthrough tab available
- **THEN** the Agent tab keeps the same tab position and keyboard shortcut

### Requirement: The review agent is visible and continues one conversation
Starting review work SHALL run a Scoped Agent Session in a host-owned checkout of the pull request head with the Project's configured provider and that provider's normal local configuration and permission behavior. The Agent tab SHALL mount the host-rendered terminal so the reviewer can see live output, retained output, failures, and permission interactions. Follow-up input from that tab SHALL continue the same session in the same Scoped Workspace. OpenForge MUST NOT enforce an immutable review checkout or prevent the provider from accessing other local resources allowed by its ordinary configuration and the current OS user.

#### Scenario: Reviewer watches generation
- **WHEN** the reviewer starts walkthrough generation from the pull request page
- **THEN** the Agent tab shows the files, history, command output, and failures produced by that run while it happens

#### Scenario: Reviewer asks a follow-up
- **WHEN** the reviewer sends a question after the generation turn completes
- **THEN** the question continues the same scoped conversation in the same checkout
- **AND** its answer appears in the Agent tab

#### Scenario: Project uses another provider
- **WHEN** the pull request's local Project is configured to use a supported provider other than Claude Code
- **THEN** review work starts that provider with its normal local configuration

#### Scenario: Agent requests a mutation
- **WHEN** the review agent requests a file mutation and the provider's normal permission behavior allows it
- **THEN** the mutation may change the Scoped Workspace and remains visible to later turns in that review session

#### Scenario: Review agent uses local extensions
- **WHEN** the configured provider normally loads a user or Project skill, plugin, hook, command, or MCP server
- **THEN** the review session can load and use that extension under the provider's normal rules

### Requirement: Walkthrough instructions use the scoped checkout for change content
Walkthrough generation SHALL direct the review agent to inspect the complete pull request change from its host-owned scoped checkout with Git. The generated instructions MUST NOT embed patch bodies. They SHALL identify the pull request's actual base ref and direct the agent to compare that ref with `HEAD` from their merge base, inspect the changed-file summary and full diff, and use repository history when needed. The instructions MUST NOT treat the latest commit alone as the pull request change.

The generated instructions SHALL keep review content separate from walkthrough submission coordinates. They SHALL omit the Changed Files review section and include a compact submission-coordinate block containing only every authoritative changed-file path and the valid zero-based hunk indexes for that file. The agent SHALL use Git to understand the change and the coordinate block only to submit steps that match the host's validation snapshot.

All other walkthrough context and command contracts SHALL remain available, including the pull request description, resolved Jira ticket, configured guidance, existing review comments, generation attempt id, walkthrough-step command, and Review Thread address.

#### Scenario: Agent inspects the complete pull request diff
- **WHEN** walkthrough generation starts for a pull request targeting `main`
- **THEN** the generated instructions direct the agent to inspect the changed-file summary and full diff from the merge base of `main` and `HEAD`
- **AND** the instructions make clear that reviewing only the latest commit is insufficient

#### Scenario: Pull request targets another base branch
- **WHEN** walkthrough generation starts for a pull request targeting `release/2026.09`
- **THEN** the generated instructions identify `release/2026.09` as the base ref used for Git comparison
- **AND** they do not hard-code `main`

#### Scenario: Large patch remains outside the instructions
- **WHEN** a pull request file contains a large patch and walkthrough generation starts in its scoped checkout
- **THEN** the generated instructions identify the base ref and submission coordinates without containing the patch body
- **AND** the agent is directed to inspect the change with Git in the checkout

#### Scenario: Manifest preserves submission coordinates
- **WHEN** the host captures a changed file with multiple patch hunks
- **THEN** the generated instructions list the exact changed-file path and every valid zero-based hunk index for that file beside the walkthrough submission contract
- **AND** the coordinate block omits file status, previous filename, addition count, and deletion count
- **AND** the existing walkthrough-step command and validation contract remain unchanged

#### Scenario: Existing review context remains available
- **WHEN** walkthrough generation has pull request context, configured guidance, existing comments, or a resolved Jira ticket
- **THEN** the generated instructions retain that context while omitting patch bodies

### Requirement: Walkthrough steps are checked and stored on submission
The review agent SHALL submit each complete walkthrough step through an agent-authorized OpenForge CLI command instead of returning a walkthrough payload in its final text. A submission SHALL contain a non-empty step id, title, summary, and at least one file reference. Each file path SHALL exactly match a file in the complete changed-file set captured for that pull request head. A file reference SHALL either select the whole file or contain unique zero-based hunk indexes that exist in that file's patch.

The host SHALL validate the whole step before storing any part of it. A rejection SHALL identify the failing input field, the rejected value, and the violated constraint, including the file's valid hunk range when a hunk index is invalid. A rejected submission MUST NOT change the stored walkthrough. A corrected retry SHALL be accepted without restarting the agent run. Reusing a step id in the same generation attempt SHALL replace that step in its original position instead of adding a duplicate.

#### Scenario: Agent submits a valid step
- **WHEN** the agent submits a step whose fields are non-empty and whose file and hunk references all exist in the captured changed-file set
- **THEN** the host stores the complete step and makes it available to the open Walkthrough view before the agent run ends

#### Scenario: File is not part of the pull request
- **WHEN** a step names `src/missing.ts` and that path is absent from the captured changed-file set
- **THEN** the host rejects the step without storing it
- **AND** the CLI response identifies the file field and says that `src/missing.ts` is not changed in the addressed pull request revision

#### Scenario: Hunk index does not exist
- **WHEN** a step selects hunk index 4 for a changed file whose patch has two hunks
- **THEN** the host rejects the step without storing it
- **AND** the CLI response identifies that hunk-index field, its rejected value, and the valid range for the file

#### Scenario: Agent corrects a rejected step
- **WHEN** the agent resubmits the same step id after correcting the rejected file or hunk reference
- **THEN** the valid step is accepted during the same agent run

#### Scenario: Agent revises an accepted step
- **WHEN** the agent resubmits an already accepted step id with another valid complete step
- **THEN** the stored step is replaced in its original position
- **AND** the walkthrough contains that step id exactly once

#### Scenario: Changed-file validation is unavailable
- **WHEN** the host cannot obtain or verify the complete changed-file set for the addressed head
- **THEN** it rejects the submission as temporarily unverifiable and stores nothing
- **AND** it does not validate against a partial file list

### Requirement: Review comments use the scope-bound Review Thread CLI
The review agent SHALL create review comments through the existing Review Thread CLI under the pull request session's exact Session Scope. The host SHALL reject a thread command whose requested address differs from the credential's Session Scope. Review Thread validation and orphan reporting SHALL remain governed by the Review Thread capability rather than the walkthrough-step validator.

#### Scenario: Agent submits a review comment
- **WHEN** the review agent creates a thread at the pull request's session address
- **THEN** the thread is visible on the pull request before the run ends

#### Scenario: Agent targets another pull request
- **WHEN** the review agent submits a Review Thread command with a target key or revision different from its Session Scope
- **THEN** the host refuses the command and stores no thread

### Requirement: Walkthrough generation has explicit terminal outcomes
The plugin SHALL track each generation attempt independently from later conversational turns. An active attempt SHALL be `generating`; a normally completed attempt with one or more accepted steps SHALL be `ready`; a normally completed attempt with no accepted steps SHALL be `no-submissions`; a failed attempt SHALL be `failed`; and a stopped attempt SHALL be `aborted`. Rejected submissions do not count as accepted steps. Every terminal outcome SHALL stop generation progress, keep the Scoped Agent Session transcript readable, and allow the reviewer to start a new attempt.

#### Scenario: Agent finishes after submitting steps
- **WHEN** a generation turn completes normally after at least one step was accepted
- **THEN** the walkthrough reaches `ready` with the accepted steps in submission order

#### Scenario: Agent submits nothing
- **WHEN** a generation turn completes normally with zero accepted steps
- **THEN** the walkthrough reaches `no-submissions`
- **AND** the UI states that the agent finished without submitting a walkthrough and offers another attempt

#### Scenario: Every submission was rejected
- **WHEN** a generation turn completes after making only rejected step submissions
- **THEN** the walkthrough reaches `no-submissions`
- **AND** the rejection reasons remain readable in the retained Agent transcript

#### Scenario: Reviewer stops generation
- **WHEN** the reviewer stops the active generation turn
- **THEN** the attempt reaches `aborted`, its accepted partial steps do not become a ready walkthrough, and another attempt can start

### Requirement: Legacy parse-path review state is retired explicitly
The plugin SHALL stop reading and writing the `pr-ai-review:<pr-id>:<head-sha>`, `pr-ai-threads:<pr-id>:<head-sha>`, and `pr-review-session:<pr-id>` storage keys. Existing local AI review comments and question threads in those keys SHALL NOT be migrated and SHALL no longer appear after the change. Follow-up conversation SHALL live in the Scoped Agent Session, and new agent review comments SHALL live as Review Threads. Valid cached walkthrough steps MAY remain readable while the walkthrough record moves away from final-output parsing.

#### Scenario: Existing local review state is upgraded
- **WHEN** a user upgrades with AI review comments or question threads stored under the retired keys
- **THEN** the plugin does not import those records into Review Threads or the Scoped Agent Session
- **AND** the records no longer appear in the pull request review UI

#### Scenario: New review completes
- **WHEN** the review agent finishes after the change
- **THEN** no `pr-ai-review:*`, `pr-ai-threads:*`, or `pr-review-session:*` value is created or updated
- **AND** the plugin does not parse the agent's final text for walkthrough steps or review comments

### Requirement: Agent tab distinguishes active review work
The pull request Agent tab SHALL expose a running state while work for its current-head Scoped Agent Session is queued, starting, or executing a provider turn. A connected session that is accepting input but has no active provider turn MUST NOT appear running. The running state SHALL be independent from unread output state.

#### Scenario: Queued or starting work appears running
- **WHEN** current-head review-agent work is queued or starting
- **THEN** the Agent tab indicates that the agent is running

#### Scenario: Active provider turn appears running
- **WHEN** the current-head review-agent session is executing a provider turn
- **THEN** the Agent tab indicates that the agent is running

#### Scenario: Idle connected session does not appear running
- **WHEN** the current-head review-agent session is connected and accepting input but has no active provider turn
- **THEN** the Agent tab does not indicate that the agent is running

#### Scenario: Running does not consume older unread output
- **GIVEN** a stopped review-agent turn has unread output
- **WHEN** a later turn starts before that output is acknowledged
- **THEN** the Agent tab indicates both running work and unread output

### Requirement: Stopped review-agent output remains unread until presented
The GitHub Sync plugin SHALL mark retained output from a current-head review-agent turn as unread when the turn becomes paused, completed, failed, aborted, or interrupted without being presented to the reviewer. Output SHALL be acknowledged only while the Agent tab is active, its terminal is ready, the document is visible, and the application window is focused. The acknowledgement SHALL persist for the exact Session Scope across navigation and application restarts, and MUST NOT acknowledge output from a different pull request head or a newer stopped turn.

#### Scenario: Hidden stopped turn becomes unread
- **GIVEN** the Agent terminal is not presented to the reviewer
- **WHEN** its turn becomes paused, completed, failed, aborted, or interrupted with retained output
- **THEN** the Agent tab indicates unread output

#### Scenario: Presented stopped turn is acknowledged
- **GIVEN** the Agent tab is active, its terminal is ready, the document is visible, and the application window is focused
- **WHEN** the current turn becomes paused, completed, failed, aborted, or interrupted with retained output
- **THEN** that output is acknowledged without leaving an unread indicator

#### Scenario: Opening the tab before the terminal is ready does not acknowledge output
- **GIVEN** the Agent tab has unread output
- **WHEN** the reviewer activates the tab but its terminal has not finished attaching
- **THEN** the unread indicator remains
- **AND WHEN** the terminal becomes ready while the document is visible and the application window is focused
- **THEN** that output is acknowledged and the unread indicator clears

#### Scenario: Background tab does not acknowledge output
- **GIVEN** the Agent tab has unread output
- **WHEN** its terminal is ready but the document is hidden or the application window is unfocused
- **THEN** the unread indicator remains
- **AND WHEN** the Agent tab is active and ready after the document and window become visible and focused
- **THEN** that output is acknowledged and the unread indicator clears

#### Scenario: A stale acknowledgement does not clear newer output
- **GIVEN** acknowledgement of an unread turn is still being stored
- **WHEN** a newer turn stops with unread output
- **THEN** completion of the older acknowledgement does not clear the newer unread indicator

#### Scenario: Read state survives navigation and restart
- **GIVEN** the reviewer has acknowledged output for an exact pull request Session Scope
- **WHEN** the reviewer navigates away and back or restarts the application
- **THEN** the acknowledged output does not become unread again

#### Scenario: Unread state survives navigation and restart
- **GIVEN** an exact pull request Session Scope has unread output
- **WHEN** the reviewer navigates away and back or restarts the application without presenting that output
- **THEN** the Agent tab still indicates unread output

#### Scenario: Pull request heads keep independent read state
- **GIVEN** one pull request head has acknowledged or unread agent output
- **WHEN** the pull request advances to a different head
- **THEN** the new head derives its own read state without inheriting the previous head's state

### Requirement: Agent activity signals are accessible
The Agent tab SHALL make running and unread states distinguishable without relying on color alone, and its accessible name SHALL identify each state that is present. Any running animation SHALL honor reduced-motion preferences while leaving the running state visually distinct from unread output. Activity signals MUST NOT change the tab's keyboard or selection behavior.

#### Scenario: Screen reader identifies both states
- **GIVEN** the Agent tab has both running work and unread output
- **WHEN** assistive technology reads the tab
- **THEN** its accessible name identifies both the running and unread states

#### Scenario: Reduced motion preserves state distinction
- **GIVEN** the reviewer requests reduced motion
- **WHEN** the Agent tab indicates running work
- **THEN** the running indicator does not animate
- **AND** its shape remains distinct from the unread-output indicator

#### Scenario: Activity signals preserve tab interaction
- **WHEN** a running or unread signal appears or disappears
- **THEN** the Agent tab retains its existing selection, focus, and keyboard behavior
