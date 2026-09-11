## Purpose

Provide a core-owned store for review conversations anchored to lines of a diff, addressed by an opaque target identity so any review surface can use it, and writable by agents through the OpenForge CLI instead of by parsing an agent's text response.

## ADDED Requirements

### Requirement: Review Threads are addressed by an opaque target identity
A Review Thread SHALL be addressed by a namespace, a target key, and a revision. The host SHALL treat the namespace and target key as opaque strings, and MUST NOT parse, validate, or resolve their meaning against any other host record. The revision SHALL identify the reviewed content version.

#### Scenario: Threads scoped to one target and revision
- **WHEN** a caller lists Review Threads for a namespace, target key, and revision
- **THEN** the host returns only threads stored under that exact triple

#### Scenario: Unknown target key is accepted
- **WHEN** a caller creates a Review Thread with a target key that matches no other host record
- **THEN** the host stores the thread and does not reject the target key

#### Scenario: A new revision starts an empty conversation
- **WHEN** a caller lists Review Threads for a target key at a revision that has no threads
- **THEN** the host returns an empty result rather than threads stored under another revision of the same target key

### Requirement: A Review Thread is one conversation with ordered messages
A Review Thread SHALL carry an anchor, an origin identifying whether the first message came from an agent, a person, or a plugin, and an ordered list of messages, each with an author role, a body, and a creation time. A reply SHALL append a message to an existing thread rather than create a second thread that references the first.

#### Scenario: Agent comment and follow-up in one thread
- **WHEN** an agent creates a thread on a line and a reviewer then replies asking why
- **THEN** both the original comment and the reply are messages of the same thread, in the order they were written

#### Scenario: Reviewer-initiated thread
- **WHEN** a reviewer creates a thread on a line with no prior agent comment
- **THEN** the host stores a thread whose origin records a person as the author of the first message

#### Scenario: Reply to an unknown thread
- **WHEN** a caller replies to a thread identifier that does not exist
- **THEN** the host rejects the reply and does not create a thread

### Requirement: Reviewer decision and pending agent turn are independent
A Review Thread SHALL carry a reviewer-facing status of open, resolved, or dismissed, and separately SHALL record whether a reply from an agent is awaited, has failed, or is not expected. Changing one MUST NOT change the other.

#### Scenario: Awaiting an answer on an open thread
- **WHEN** a reviewer asks an agent a question on an open thread
- **THEN** the thread stays open and additionally records that an agent reply is awaited

#### Scenario: Resolving a thread with a failed agent turn
- **WHEN** an agent reply fails and the reviewer then resolves the thread
- **THEN** the thread reports the resolved status and still reports the failed agent turn

### Requirement: Every enabled plugin can read and write Review Threads
The public Plugin SDK SHALL expose Review Thread list, create, reply, and status operations on both the frontend and backend surfaces. Access MUST NOT depend on the plugin's identity: any enabled plugin, including one installed from outside the application, SHALL be able to call every Review Thread operation.

#### Scenario: Externally installed plugin writes a thread
- **WHEN** an enabled plugin that is not built into the application creates a Review Thread
- **THEN** the host stores it and returns the created thread

#### Scenario: Disabled plugin is refused
- **WHEN** a disabled plugin attempts any Review Thread operation
- **THEN** the host refuses the call for the same reason it refuses that plugin's other calls

### Requirement: Agents create and reply to Review Threads through the CLI
The OpenForge CLI SHALL provide commands for an agent to create a thread, reply to a thread, list threads, and set a thread's status. These routes SHALL be reachable by an authorized agent over the agent transport. An agent MUST NOT need to encode threads in its response text for them to be stored.

#### Scenario: Agent posts a comment mid-review
- **WHEN** an authorized agent runs the CLI to create a thread on a file and line during its run
- **THEN** the thread is stored immediately and is visible to a caller listing that target and revision, before the agent's run ends

#### Scenario: Agent run ends without posting
- **WHEN** an agent finishes its run and posted no threads
- **THEN** the target and revision has no threads, and the host reports no parse or extraction error

#### Scenario: Unauthorized caller on the agent transport
- **WHEN** a caller without a valid agent identity calls a Review Thread route over the agent transport
- **THEN** the host refuses the call and stores nothing

### Requirement: Thread creation is idempotent per caller-supplied key
A create request MAY carry an idempotency key scoped to its namespace, target key, and revision. When a create request repeats a key already stored for that triple, the host SHALL return the existing thread and MUST NOT create a second thread.

#### Scenario: Retried create after a transport failure
- **WHEN** an agent repeats a create request with the same idempotency key because the first attempt returned no response
- **THEN** the host returns the thread created by the first attempt and the target holds exactly one thread for that key

#### Scenario: Same key on a different revision
- **WHEN** a caller reuses an idempotency key under a different revision of the same target key
- **THEN** the host creates a separate thread, because the key is scoped to the revision

#### Scenario: Create without a key
- **WHEN** a caller creates a thread and supplies no idempotency key
- **THEN** the host creates a thread and does not deduplicate the request

### Requirement: Anchors are validated at write time and rejected with a reason
The host SHALL reject a create request whose anchor violates a structural invariant, including an empty file path, a line number below one, or a side that is neither the pre-image nor the post-image. A rejection SHALL carry a message naming the invalid field so the caller can correct and retry. The host MUST NOT silently drop an invalid thread.

#### Scenario: Line number below one
- **WHEN** an agent creates a thread with a line number of zero
- **THEN** the host rejects the request with a message naming the line number, and the thread is not stored

#### Scenario: Rejection does not discard the rest of a review
- **WHEN** one of several create requests in a run is rejected
- **THEN** the threads created by the other requests remain stored

#### Scenario: Anchor on a line outside the diff
- **WHEN** a caller creates a thread whose file and line are structurally valid but fall outside the reviewed diff
- **THEN** the host accepts and stores the thread, because resolving an anchor against a diff is not a write-time check

### Requirement: A thread whose anchor cannot be placed is reported as orphaned
When a review surface renders threads for a revision and a thread's anchor does not resolve to a line it is showing, that surface SHALL report the thread as orphaned rather than hide it.

#### Scenario: Anchor points at a file not in the diff
- **WHEN** a review surface renders a revision and a stored thread anchors to a file the diff does not contain
- **THEN** the surface reports that thread as orphaned and the reviewer can still read and resolve it

### Requirement: Run association is opaque to the host
A Review Thread MAY carry a run identifier supplied by its creator. The host SHALL store and return it unchanged and MUST NOT derive run state, progress, or completion from it.

#### Scenario: Threads grouped by run
- **WHEN** a caller lists threads for a target and revision
- **THEN** each thread reports the run identifier it was created with, or none

#### Scenario: Host reports no run progress
- **WHEN** a caller asks the host whether a run is still producing threads
- **THEN** no such host operation exists, and the caller that owns the run reports its own progress

### Requirement: Thread changes are observable without polling
The public Plugin SDK SHALL let a caller subscribe to Review Thread changes for a namespace, target key, and revision. A notification SHALL indicate that the threads for that scope may be stale and MUST NOT be treated as a thread snapshot.

#### Scenario: Agent write reaches an open review surface
- **WHEN** an agent creates a thread while a reviewer has that target and revision open
- **THEN** subscribers for that scope are notified and the surface shows the new thread after it repeats its list call

#### Scenario: Change in an unrelated scope
- **WHEN** a thread changes under a different target key or revision
- **THEN** subscribers for the open scope are not notified

### Requirement: The diff viewer renders threads supplied by its host
The shared diff viewer SHALL accept Review Threads and thread create, reply, and status callbacks from whichever surface embeds it, and MUST NOT read them from the host itself. Agent-authored and person-authored threads SHALL render through one inline presentation.

#### Scenario: Two surfaces, one viewer
- **WHEN** two different review surfaces embed the diff viewer with their own threads and callbacks
- **THEN** each renders its own threads, and the viewer performs no lookup of its own to obtain them

#### Scenario: Uniform inline presentation
- **WHEN** an agent-authored thread and a person-authored thread anchor to the same line
- **THEN** both render inline through the same thread presentation, distinguished by the author of each message
