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
