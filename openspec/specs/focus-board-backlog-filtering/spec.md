# Focus Board Backlog Filtering Specification

## Purpose

Defines a compact way to select Task Labels when filtering the Focus Board Backlog view while preserving the board's existing filtering behavior.

## Requirements

### Requirement: Backlog label filters use a multiselect dropdown
When the Backlog view has labels with matching Backlog Tasks, the system SHALL present those label filters through one compact multiselect dropdown instead of an inline row of label chips.

#### Scenario: Backlog labels are available
- **WHEN** the user opens the Backlog view and at least one label has a nonzero Backlog Task count
- **THEN** the system displays one label-filter dropdown trigger
- **AND** the system does not display the former inline label-filter chip row

#### Scenario: No Backlog labels are available
- **WHEN** the user opens the Backlog view and no label has a nonzero Backlog Task count
- **THEN** the system does not display the label-filter dropdown

#### Scenario: Another board view is active
- **WHEN** the user selects Focus, In Flight, or Out of Focus
- **THEN** the system does not display the Backlog label-filter dropdown
- **AND** the top-level board filter controls retain their existing single-select behavior

### Requirement: Dropdown options preserve label information
The system SHALL list every label with a nonzero Backlog Task count as a selectable dropdown option, including its current count and selected state.

#### Scenario: User opens the dropdown
- **WHEN** the user opens the Backlog label-filter dropdown
- **THEN** each available label appears as a selectable option
- **AND** each option shows its Backlog Task count
- **AND** each option communicates whether it is selected

#### Scenario: A label count reaches zero
- **WHEN** an available label's Backlog Task count reaches zero
- **THEN** the system removes that label from the dropdown options
- **AND** the system removes that label from the active selection

### Requirement: Label selection behavior remains unchanged
The system SHALL apply selected labels immediately using OR semantics and SHALL preserve the existing project-scoped selection lifecycle.

#### Scenario: User selects one label
- **WHEN** the user selects a label in the dropdown
- **THEN** the Backlog list displays Tasks carrying that label
- **AND** the dropdown remains available for further selections

#### Scenario: User selects multiple labels
- **WHEN** the user selects more than one label
- **THEN** the Backlog list displays Tasks carrying any selected label
- **AND** the dropdown trigger communicates the number of selected labels

#### Scenario: User clears all selected labels
- **WHEN** the user deselects every label
- **THEN** the Backlog list displays Tasks without applying a label constraint

#### Scenario: Board remounts for the same project
- **WHEN** the Focus Board unmounts and remounts for the same project during the project session
- **THEN** the system restores the selected Backlog label filters

#### Scenario: User switches projects
- **WHEN** the active project changes
- **THEN** the system clears the previous project's selected Backlog label filters

### Requirement: Dropdown supports keyboard interaction
The Backlog label-filter dropdown SHALL expose its expanded and selected states to assistive technology and SHALL support keyboard operation.

#### Scenario: User opens and selects with the keyboard
- **WHEN** the user focuses the dropdown trigger and activates it with the keyboard
- **THEN** the system opens the dropdown and moves focus to an available option
- **AND** the user can toggle label options without closing the dropdown

#### Scenario: User closes with Escape
- **WHEN** the dropdown is open and the user presses Escape
- **THEN** the system closes the dropdown
- **AND** focus returns to the dropdown trigger
