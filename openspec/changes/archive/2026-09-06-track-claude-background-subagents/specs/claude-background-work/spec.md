## Purpose

Defines when an OpenForge task keeps its agent session marked running after the Claude agent's turn ends, and what evidence OpenForge accepts as proof that background work is still in flight.

## ADDED Requirements

### Requirement: A task stays running while Claude has outstanding background work

When the Claude agent's turn ends, the system SHALL keep the task's agent session `running` if Claude still has background work in flight, and SHALL complete the session only when no background work remains.

#### Scenario: The turn ends with background work in flight
- **WHEN** the Claude agent's turn ends and at least one background work item is still in flight
- **THEN** the task's agent session stays `running`
- **AND** the task is not surfaced as needing attention

#### Scenario: The turn ends with nothing in flight
- **WHEN** the Claude agent's turn ends and no background work is in flight
- **THEN** the task's agent session is marked `completed`

#### Scenario: Background work wakes the agent
- **WHEN** background work finishes and the Claude agent resumes on its own
- **THEN** the task's agent session stays `running` without an intervening `completed` state

### Requirement: Backgrounded subagents count as outstanding work

The system SHALL treat a subagent that Claude launched into the background as outstanding background work until that subagent reports that it has stopped.

#### Scenario: A subagent is launched into the background
- **WHEN** Claude launches a subagent asynchronously and the turn ends before the subagent reports
- **THEN** the subagent counts as outstanding background work
- **AND** the task's agent session stays `running`

#### Scenario: A subagent ran to completion within the turn
- **WHEN** Claude ran a subagent synchronously and it had already returned its result before the turn ended
- **THEN** that subagent does not count as outstanding background work

#### Scenario: A backgrounded subagent reports that it stopped
- **WHEN** a backgrounded subagent announces that it has stopped
- **THEN** it no longer counts as outstanding background work
- **AND** the task's agent session completes once no other background work remains

#### Scenario: Several subagents run concurrently
- **WHEN** several backgrounded subagents are in flight and one of them stops
- **THEN** the task's agent session stays `running` until every one of them has stopped

### Requirement: A reported inventory of in-flight work takes precedence

The agent reports the background work registered in a session as part of the turn-end hook payload, already filtered to what is still in flight. When that inventory is present, the system SHALL treat it as the authoritative account and SHALL NOT consult the session transcript. When it is absent, the system SHALL fall back to inspecting the transcript.

#### Scenario: The turn-end payload reports an inventory
- **WHEN** the turn-end hook payload includes the session's background work inventory
- **THEN** the system decides whether work is outstanding from that inventory alone
- **AND** the session transcript is not read

#### Scenario: A deferral sourced from the inventory reaches its deadline
- **WHEN** work reported in the inventory is still outstanding once the grace period elapses
- **THEN** the task's agent session is marked `completed`
- **AND** the transcript is not consulted to extend the deferral beyond that deadline

#### Scenario: The reported inventory is empty
- **WHEN** the turn-end hook payload reports an empty inventory
- **THEN** no background work is outstanding
- **AND** the task's agent session is marked `completed`

#### Scenario: The reported inventory contradicts a stale transcript
- **WHEN** the turn-end hook payload reports an empty inventory and the transcript still shows an item that never announced a stop
- **THEN** the task's agent session is marked `completed`

#### Scenario: The agent build does not report an inventory
- **WHEN** the turn-end hook payload omits the inventory field
- **THEN** the system falls back to inspecting the session transcript for outstanding background work
- **AND** an absent inventory is not read as an empty one

#### Scenario: The inventory is not a list
- **WHEN** the turn-end hook payload carries an inventory that is not a list
- **THEN** the hook is still processed rather than rejected
- **AND** the system falls back to inspecting the session transcript

#### Scenario: An entry in the inventory cannot be read
- **WHEN** the inventory lists an entry whose fields the system does not recognise
- **THEN** that entry counts as outstanding background work
- **AND** the task's agent session stays `running`

### Requirement: Teammates in the inventory do not hold a task running

Long-lived in-process teammates stay registered as running between turns while parked awaiting work. The system SHALL exclude teammate entries when deciding whether background work is outstanding.

#### Scenario: The inventory lists only a teammate
- **WHEN** the turn-end hook payload reports an inventory whose only entry is a teammate
- **THEN** no background work is outstanding
- **AND** the task's agent session is marked `completed`

#### Scenario: The inventory lists a teammate alongside other work
- **WHEN** the turn-end hook payload reports a teammate and a running subagent
- **THEN** the subagent counts as outstanding background work
- **AND** the task's agent session stays `running`

### Requirement: Unrecognised kinds of background work are treated as in flight

The inventory identifies each item by kind, and new kinds can appear in later agent releases. The system SHALL treat an item as in flight unless it identifies itself as a teammate or reports a state that means it is no longer running. No other property of an entry may disqualify it, because an entry the system cannot read is still evidence that the agent registered something.

#### Scenario: An unrecognised kind is reported
- **WHEN** the inventory lists an item whose kind the system does not recognise
- **THEN** that item counts as outstanding background work

#### Scenario: An item reports a state that is not in flight
- **WHEN** the inventory lists an item whose state is neither running nor pending
- **THEN** that item does not count as outstanding background work

#### Scenario: An item omits its kind or state
- **WHEN** the inventory lists an item that omits its kind, its state, or both
- **THEN** that item counts as outstanding background work

#### Scenario: An item omits its identifier
- **WHEN** the inventory lists an item that carries no readable identifier
- **THEN** that item counts as outstanding background work
- **AND** it is described as unidentified in the deferral log

### Requirement: Outstanding background work does not hold a task running without bound

Background work can run indefinitely, so the system SHALL stop holding a task's agent session open once a configured grace period elapses without the agent resuming, and SHALL record that the work outlived the grace period rather than that it finished.

#### Scenario: Background work outlives the grace period
- **WHEN** background work is still in flight after the grace period elapses and the agent has not resumed
- **THEN** the task's agent session is marked `completed`
- **AND** the recorded reason states that the background work outlived the grace period

#### Scenario: The agent resumes before the grace period elapses
- **WHEN** the agent resumes before the grace period elapses and its next turn also ends with work in flight
- **THEN** the grace period is measured again from that turn's end
