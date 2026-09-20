## MODIFIED Requirements

### Requirement: The Agent tab is a stable pull request detail tab
Every pull request detail view SHALL show an Agent tab whether or not a session or walkthrough exists. The tab SHALL remain addressable at one stable keyboard position while the Walkthrough tab remains conditional on an available walkthrough. Opening the Agent tab for a pull request head with no Scoped Agent Session SHALL start one interactive review agent automatically without starting a walkthrough attempt. Reopening the tab for that head SHALL attach to the existing session instead of starting another one.

The Agent tab body SHALL contain only the host-rendered terminal presentation. It MUST NOT contain a session status header, a Stop action, an explanatory form, or a separate follow-up input. When no local Project can supply the repository checkout, the terminal area SHALL report why startup is unavailable and the Generate walkthrough action SHALL remain unavailable.

#### Scenario: Pull request has no session yet
- **WHEN** a reviewer opens the Agent tab for a pull request head with no Scoped Agent Session and the repository maps to a local Project
- **THEN** the plugin starts one interactive read-only review agent for that head
- **AND** the tab mounts its terminal without starting a walkthrough attempt

#### Scenario: Reviewer returns to Agent
- **WHEN** a reviewer reopens the Agent tab for a pull request head that already has a Scoped Agent Session
- **THEN** the tab reattaches to that session and its retained terminal output
- **AND** it does not start a duplicate session

#### Scenario: Repository has no local Project
- **WHEN** a reviewer opens the Agent tab for a repository that cannot be mapped to a local Project
- **THEN** the terminal area reports that the review agent cannot start
- **AND** Generate walkthrough is unavailable

#### Scenario: Walkthrough becomes available
- **WHEN** the first accepted walkthrough step makes the conditional Walkthrough tab available
- **THEN** the Agent tab keeps the same tab position and keyboard shortcut

### Requirement: The review agent is visible and continues one conversation
The automatically started review agent SHALL run as a Scoped Agent Session in a host-owned checkout of the pull request head under the host's read-only review policy. The Agent tab SHALL show the live, interactive TTY using the same terminal presentation as the Task Agent tab, including retained output, failures, permission interactions, and direct keyboard input. A running session MUST render as a usable TTY rather than a blank region or serialization error.

The pull request header SHALL provide a Generate walkthrough action while the Agent tab is active. Invoking Generate SHALL send the walkthrough prompt into the existing Scoped Agent Session and SHALL NOT create a second session. The action SHALL be unavailable while the session cannot accept the prompt or a walkthrough attempt is already generating. Follow-up input typed directly into the TTY SHALL continue the same session in the same Scoped Workspace. The session MUST NOT edit the checkout, even after interactive user approval.

#### Scenario: Running session renders its TTY
- **WHEN** the automatically started review agent reaches a runnable state
- **THEN** the Agent tab displays its interactive terminal across the tab body
- **AND** the reviewer can focus the terminal and type into the agent session

#### Scenario: Reviewer watches generation
- **WHEN** the reviewer invokes Generate while the interactive agent can accept input and no walkthrough attempt is generating
- **THEN** the walkthrough prompt is sent into that same session
- **AND** the reviewer sees the agent process the prompt in the terminal as it happens

#### Scenario: Reviewer asks a follow-up
- **WHEN** the reviewer types and submits a question in the TTY after a generation turn completes
- **THEN** the question continues the same scoped conversation in the same checkout
- **AND** its answer appears in that terminal

#### Scenario: Agent requests a mutation
- **WHEN** the review agent requests a file mutation and the reviewer approves the provider prompt
- **THEN** the host's final policy check still refuses the mutation
- **AND** the Scoped Workspace remains unchanged

### Requirement: Walkthrough generation has explicit terminal outcomes
The plugin SHALL track each Generate invocation independently from the longer-lived interactive session. An active attempt SHALL be `generating`; a normally completed attempt with one or more accepted steps SHALL be `ready`; a normally completed attempt with no accepted steps SHALL be `no-submissions`; a failed provider exit SHALL be `failed`; and a host-aborted session SHALL produce an `aborted` attempt. Rejected submissions do not count as accepted steps. Every terminal outcome SHALL stop generation progress, keep the Scoped Agent Session transcript readable, and make Generate available for a later attempt when the session can accept input. The Agent tab SHALL NOT add a dedicated Stop action or generation-status panel around the terminal.

#### Scenario: Agent finishes after submitting steps
- **WHEN** the generated walkthrough turn completes normally after at least one step was accepted
- **THEN** the walkthrough reaches `ready` with the accepted steps in submission order

#### Scenario: Agent submits nothing
- **WHEN** the generated walkthrough turn completes normally with zero accepted steps
- **THEN** the walkthrough reaches `no-submissions`
- **AND** the retained terminal output remains readable and Generate becomes available for another attempt

#### Scenario: Every submission was rejected
- **WHEN** a generated walkthrough turn completes after making only rejected step submissions
- **THEN** the walkthrough reaches `no-submissions`
- **AND** the rejection reasons remain readable in the retained Agent transcript

#### Scenario: Reviewer stops generation
- **WHEN** the host aborts the Scoped Agent Session during an active walkthrough attempt
- **THEN** the attempt reaches `aborted` and its accepted partial steps do not become a ready walkthrough
- **AND** the Agent tab does not require or show a separate Stop action

#### Scenario: Provider exits during generation
- **WHEN** the provider process exits unsuccessfully during an active walkthrough attempt
- **THEN** the attempt reaches `failed`
- **AND** its accepted partial steps do not become a ready walkthrough
