# Diff Viewer File Path Copy Specification

## Purpose

Enable reviewers to copy a changed file's displayed repository-relative path directly from the Diff Viewer without disrupting their review state.

## Requirements

### Requirement: Copy the current file path
The system SHALL provide an explicit copy action on each current file path displayed in a Diff Viewer file header. Activating the action SHALL request that the exact current repository-relative path be written to the system clipboard.

#### Scenario: Copy with a pointer
- **WHEN** a user clicks the displayed current path for a file
- **THEN** the system writes that current repository-relative path to the clipboard

#### Scenario: Copy with a keyboard
- **WHEN** a user focuses the displayed path copy action and activates it with the keyboard
- **THEN** the system writes that current repository-relative path to the clipboard

#### Scenario: Copy a renamed file path
- **WHEN** a file header displays both a previous path and a current path and the user activates the path copy action
- **THEN** the system writes the current path to the clipboard rather than the previous path or the combined rename presentation

### Requirement: Preserve file-header state when copying
The system SHALL treat copying a file path as independent from the file header's collapse and expansion interaction.

#### Scenario: Copy an expanded file path
- **WHEN** a user copies the path of an expanded file
- **THEN** the file remains expanded

#### Scenario: Copy a collapsed file path
- **WHEN** a user copies the path of a collapsed file
- **THEN** the file remains collapsed

### Requirement: Identify the path copy action accessibly
The system SHALL expose the displayed path as an interactive control whose accessible name identifies both the copy action and the current path.

#### Scenario: Discover the copy action with assistive technology
- **WHEN** assistive technology inspects a displayed current file path
- **THEN** it identifies a control for copying that specific current file path
