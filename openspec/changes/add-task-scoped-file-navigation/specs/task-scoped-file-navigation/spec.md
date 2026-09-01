## Purpose

Provide revision-correct repository file navigation inside task review and let users browse the live task worktree without leaving the task context.

## ADDED Requirements

### Requirement: Task worktree file browser
The system SHALL provide a Files tab in a task workbench that browses and previews files from that task's resolved live workspace.

#### Scenario: Browse a task worktree
- **WHEN** a user opens the Files tab for a task with a resolved worktree
- **THEN** the file tree and previews SHALL read from that task worktree
- **AND** content from the project checkout or another task SHALL NOT be substituted

#### Scenario: Task workspace is unavailable
- **WHEN** the task Files tab cannot resolve or read the task workspace
- **THEN** it SHALL show an unavailable or error state
- **AND** it SHALL NOT fall back to the project checkout

### Requirement: Changed-file link navigation
The system SHALL keep a user in Review when a repository-relative link targets a file displayed in the active diff.

#### Scenario: Link target is displayed in the diff
- **WHEN** a user activates a repository-relative link whose target file is displayed in the active diff
- **THEN** Review SHALL navigate to that file in the diff
- **AND** the active task, review scope, and diff state SHALL remain selected

### Requirement: Review-local linked-file preview
The system SHALL preview repository-relative link targets that are not displayed in the active diff within Review, without replacing the active review context.

#### Scenario: Preview from the current task review
- **WHEN** a user activates a repository-relative link whose target is not displayed in the active diff and no historical commit is selected
- **THEN** Review SHALL open a read-only preview of the target from the task's active review workspace
- **AND** closing the preview SHALL restore the previous diff position and state

#### Scenario: Preview while reviewing a commit
- **WHEN** a user activates a repository-relative link while a historical commit is selected
- **THEN** Review SHALL preview the target as it exists at that selected commit
- **AND** it SHALL NOT silently show the live worktree or project checkout version

#### Scenario: Linked file cannot be read
- **WHEN** the linked path is missing, invalid, or unreadable in the active review revision
- **THEN** Review SHALL show an error for that target
- **AND** it SHALL preserve the current diff and SHALL NOT fall back to another workspace

### Requirement: Reveal a reviewed file in task Files
A Review linked-file preview SHALL offer an action that reveals the same repository path in the task Files tab.

#### Scenario: Open preview target in task Files
- **WHEN** a user chooses to open a Review preview target in Files
- **THEN** the system SHALL activate the Files tab for the same task
- **AND** it SHALL select the target path in the live task worktree
- **AND** the Files tab SHALL identify that it represents the live worktree rather than a selected historical commit

### Requirement: Repository link suffix preservation
The system SHALL preserve repository-relative link fragments and query suffixes across diff navigation, Review previews, and task Files navigation.

#### Scenario: Link includes a fragment
- **WHEN** a repository-relative link contains a fragment identifying content within the target
- **THEN** the destination SHALL receive the fragment intact
- **AND** it SHALL focus or scroll to the identified content when that destination can resolve it

#### Scenario: Link includes a query suffix
- **WHEN** a repository-relative link contains a query suffix
- **THEN** navigation SHALL retain the suffix without using it as part of the repository file path

### Requirement: Task-scoped plugin filesystem access
The plugin API SHALL provide additive task-scoped directory listing, file reading, and file search operations for trusted plugins.

#### Scenario: Trusted plugin reads a task file
- **WHEN** a trusted plugin requests a repository-relative file for a valid task workspace
- **THEN** the API SHALL resolve the task's current workspace and return that file using the existing file content classifications

#### Scenario: Plugin attempts to escape the task workspace
- **WHEN** a task-scoped filesystem request contains an absolute path or traversal outside the resolved workspace
- **THEN** the API SHALL reject the request without reading outside the workspace

#### Scenario: Existing project filesystem caller
- **WHEN** an existing plugin uses the project-scoped filesystem API
- **THEN** its request and behavior SHALL remain compatible

### Requirement: File-viewer scope isolation
The file viewer SHALL keep project and task browsing state separate for each workspace identity.

#### Scenario: Switch between project and task Files views
- **WHEN** a user selects files in a project Files view and one or more task Files tabs
- **THEN** each project and task scope SHALL retain its own selected path, expanded directories, search state, and scroll positions
- **AND** a reveal request for one scope SHALL NOT change another scope's state
