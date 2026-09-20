# task-dependency-removal Specification

## Purpose

Allow users to remove individual task dependencies inside their existing chips while preventing navigation clicks, repeated input, and stale UI state from causing unintended removal.

## Requirements

### Requirement: Explicit dependency management mode
The Dependencies section SHALL hide removal controls until the user enables Manage dependencies. Management SHALL apply only to dependencies of the task being viewed. Dependent tasks SHALL remain navigation-only.

#### Scenario: Enter and leave management
- **WHEN** the user enables Manage dependencies on a task with dependencies
- **THEN** each dependency chip SHALL show an icon-only removal button
- **AND** leaving management SHALL hide those controls and discard unsubmitted confirmation

#### Scenario: Ordinary relationship navigation
- **WHEN** the user activates the task identity portion of a chip
- **THEN** the system SHALL retain existing related-task navigation
- **AND** SHALL NOT remove a relationship

### Requirement: Inline icon-only confirmation
Activating a chip's removal button SHALL replace its action area with separate confirm and cancel icon buttons inside the same chip, without a confirmation dialog. Chip action buttons SHALL NOT contain visible text. The task identity SHALL remain visible. At most one chip SHALL await confirmation.

#### Scenario: Request removal
- **WHEN** the user activates a dependency's trash icon
- **THEN** the chip SHALL expose a confirm icon and a cancel icon
- **AND** no relationship write SHALL occur

#### Scenario: Cancel or select another dependency
- **WHEN** the user activates cancel, presses Escape, or requests removal on another chip
- **THEN** the prior chip's unsubmitted confirmation SHALL be discarded without a relationship write
- **AND** requesting removal on another chip SHALL confirm nothing on the prior chip

### Requirement: Deliberate confirmation and accessible controls
Removal SHALL require an independent activation of the confirm button. Double-clicking or double-tapping the original trash location and holding an activation key SHALL NOT confirm removal. Controls SHALL be keyboard-operable, have visible focus and task-specific accessible names, and expose descriptive tooltips on hover and focus. Destructive intent SHALL NOT rely on color alone.

#### Scenario: Repeated pointer activation
- **WHEN** the user double-clicks or double-taps a chip's trash location
- **THEN** the dependency SHALL remain intact and no removal request SHALL be sent

#### Scenario: Keyboard activation
- **WHEN** the user opens inline confirmation with the keyboard
- **THEN** focus SHALL move to cancel rather than confirm
- **AND** holding the activation key SHALL NOT remove the dependency
- **AND** the user SHALL be able to move focus explicitly to confirm and activate it

#### Scenario: Explain the action without visible button text
- **WHEN** assistive technology reads the confirm control or a user reveals its tooltip
- **THEN** it SHALL identify both the current task and prerequisite and explain that confirmation removes the waiting relationship, not either task

### Requirement: Atomic single-relationship removal
Confirmation SHALL remove only the selected direct dependency relationship. It SHALL preserve both tasks and unrelated relationships, including concurrent additions. Repeating removal of an already absent relationship between existing tasks SHALL succeed without changing other data. A missing current task SHALL produce a recoverable error. Removal SHALL NOT automatically start a task or bypass remaining start safeguards.

#### Scenario: Confirm selected dependency
- **WHEN** the user deliberately confirms removal of prerequisite B from task A
- **THEN** only A's direct dependency on B SHALL be removed
- **AND** neither task SHALL be deleted or automatically started

#### Scenario: Concurrent unrelated addition
- **WHEN** another actor adds prerequisite C after A's chips were loaded and the user removes B
- **THEN** A's dependency on C SHALL remain intact

#### Scenario: Relationship already removed
- **WHEN** both tasks still exist but another actor has already removed the selected relationship
- **THEN** confirmation SHALL succeed as a no-op and the UI SHALL reconcile with current state

#### Scenario: Current task disappeared
- **WHEN** the current task no longer exists when removal is processed
- **THEN** removal SHALL fail with a recoverable error and SHALL NOT modify another task

### Requirement: Pending, failure, and authoritative refresh
The UI SHALL issue at most one removal request at a time per Dependencies section and disable its mutation controls while saving. It SHALL keep the chip until persistence succeeds. After success, authoritative relationship data SHALL update the chip list, waiting count, readiness, and affected cached relationship views. A refresh failure after successful persistence SHALL be distinguished from a failed removal.

#### Scenario: Removal is pending
- **WHEN** a confirmed removal request is unresolved
- **THEN** the chip SHALL indicate busy state
- **AND** repeated confirmation or actions on other chips SHALL NOT send another removal request

#### Scenario: Persistence fails
- **WHEN** removal fails before success is confirmed
- **THEN** the chip SHALL remain visible with an accessible error
- **AND** retry SHALL require another deliberate confirmation

#### Scenario: Successful removal or refresh failure
- **WHEN** persistence succeeds
- **THEN** the system SHALL reconcile the task's dependencies and affected relationship views without overwriting newer data
- **AND** if reconciliation fails it SHALL report that removal succeeded but refresh failed and offer a refresh retry rather than another removal

### Requirement: Task-scoped interaction lifetime
Management and unsubmitted confirmation SHALL reset when the viewed task changes, the section is collapsed, or the view is destroyed. If the selected relationship disappears during refresh, its confirmation SHALL be discarded. An in-flight result SHALL remain associated with its original task and SHALL NOT mutate a newly viewed task's interaction state.

#### Scenario: Switch tasks during confirmation or saving
- **WHEN** the user changes the viewed task
- **THEN** the new task SHALL start outside manage mode with no pending confirmation
- **AND** any prior request completion SHALL NOT remove a chip or display a task-local error on the new task

#### Scenario: Relationship disappears while confirming
- **WHEN** refreshed data no longer contains the relationship awaiting confirmation
- **THEN** the UI SHALL discard that confirmation without issuing removal
