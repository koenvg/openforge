## ADDED Requirements

### Requirement: Explicit CLI removal of one prerequisite
The OpenForge CLI SHALL accept `task dependencies remove --task-id <id> --depends-on <task-id>` with exactly one non-empty prerequisite ID. It SHALL remove only that direct relationship through native dependency handling, preserving both tasks, other prerequisites, and concurrent additions. Removal of an absent relationship SHALL succeed as a no-op when the current task exists. A missing current task SHALL fail. Removing a prerequisite SHALL NOT automatically start the current task.

#### Scenario: Remove one of multiple prerequisites
- **WHEN** task A depends on B and C and the caller removes B with the CLI
- **THEN** A no longer depends on B and still depends on C
- **AND** neither task is deleted or started

#### Scenario: Another prerequisite was added after the caller last read the task
- **WHEN** the caller removes B and another actor has added C to A
- **THEN** the relationship from A to C remains intact

#### Scenario: Remove an absent link or a link from a missing task
- **WHEN** the caller removes a prerequisite that is not linked to an existing task
- **THEN** the command succeeds without modifying other relationships
- **WHEN** the current task does not exist
- **THEN** the command fails without modifying another task

#### Scenario: Omitted or ambiguous prerequisite
- **WHEN** the caller omits `--depends-on`, supplies only empty list entries, or supplies multiple prerequisite IDs to `remove`
- **THEN** the command rejects the request without issuing a dependency write

### Requirement: Explicit CLI clearing of prerequisites
The OpenForge CLI SHALL accept `task dependencies clear --task-id <id>` to remove every direct prerequisite of the current task through native dependency handling. It SHALL preserve the task and its incoming dependent relationships. Clearing a missing current task SHALL fail. The existing `task dependencies set` command SHALL continue to reject an empty or omitted `--depends-on` list, so only the explicit `clear` command clears the list.

#### Scenario: Clear the full list
- **WHEN** a caller clears prerequisites for a task that has multiple direct prerequisites
- **THEN** its direct prerequisite list is empty
- **AND** the task remains available without being automatically started

#### Scenario: Clear an empty list or a missing task
- **WHEN** the caller clears a task with no direct prerequisites
- **THEN** the command succeeds with an empty list
- **WHEN** the current task does not exist
- **THEN** the command fails without changing other tasks

#### Scenario: Empty set input is not clear
- **WHEN** a caller runs `task dependencies set` with no non-empty `--depends-on` values
- **THEN** the CLI rejects the request without changing prerequisites
