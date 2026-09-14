## Purpose

Defines how the Create Task dialog resists accidental dismissal and how an unsaved prompt draft is retained, restored, superseded by a supplied seed, discarded, and cleared, so that closing the dialog never destroys unsaved work.

## ADDED Requirements

### Requirement: Backdrop dismissal depends on prompt content

While the Create Task prompt contains non-whitespace content, activating the area surrounding the dialog SHALL NOT dismiss the dialog and SHALL leave the prompt, properties, and attachments unchanged. While the prompt is empty or whitespace only, activating that area SHALL dismiss the dialog.

#### Scenario: Backdrop is clicked with a typed prompt
- **WHEN** the user has typed a prompt into Create Task and clicks the area surrounding the dialog
- **THEN** the dialog remains open
- **AND** the prompt, selected properties, and attachments are unchanged

#### Scenario: Backdrop is clicked with an empty prompt
- **WHEN** the Create Task prompt is empty or whitespace only and the user clicks the area surrounding the dialog
- **THEN** the dialog is dismissed

#### Scenario: Window focus is restored by a click on the backdrop
- **WHEN** the application window is unfocused, the Create Task prompt contains content, and the user clicks the area surrounding the dialog to restore focus
- **THEN** the dialog remains open with the prompt intact

### Requirement: Dismissal retains the prompt draft

Dismissing Create Task without saving SHALL retain the prompt text and every pasted image referenced by that text. Retention SHALL apply to every dismissal path, including Escape, the header close control, and the footer close control. Retention SHALL NOT apply to the properties of the draft, which are the title, source ticket, AI provider, permission mode, worktree choice, and branch selection.

#### Scenario: Escape dismisses a typed prompt
- **WHEN** the user presses Escape in Create Task with a typed prompt
- **THEN** the dialog closes without creating a task
- **AND** the prompt text is retained for that project

#### Scenario: Close control dismisses a typed prompt
- **WHEN** the user dismisses Create Task using the header or footer close control with a typed prompt
- **THEN** the prompt text is retained for that project

#### Scenario: Pasted images are retained with the prompt
- **WHEN** the user dismisses Create Task with a prompt that references pasted images
- **THEN** those images are retained alongside the prompt text

#### Scenario: A deleted image reference is not retained
- **WHEN** the user deletes an image reference from the prompt and then dismisses Create Task
- **THEN** that image is not retained and does not reappear on reopen

### Requirement: Reopening restores the retained draft

Opening Create Task for a project with a retained draft and no supplied prompt seed SHALL restore the retained prompt text and its pasted images. Properties SHALL be initialized from project defaults rather than from the retained draft. A submitted prompt restored from a draft SHALL resolve every image reference it contains.

#### Scenario: Draft is restored on reopen
- **WHEN** the user reopens Create Task for a project that has a retained draft
- **THEN** the prompt shows the retained text
- **AND** the pasted images it references are available again

#### Scenario: Restored draft submits complete
- **WHEN** the user submits a restored draft whose prompt references pasted images
- **THEN** the created task carries both the prompt text and every referenced image

#### Scenario: Properties are not restored
- **WHEN** the user reopens Create Task for a project that has a retained draft
- **THEN** the title, source ticket, AI provider, permission mode, worktree choice, and branch selection come from project defaults

### Requirement: Retained drafts are scoped per project and to the session

The system SHALL retain at most one Create Task draft per project and SHALL keep each project's draft independent. Retained drafts SHALL exist only for the lifetime of the running application and SHALL NOT be persisted to durable storage.

#### Scenario: Two projects hold independent drafts
- **WHEN** the user dismisses Create Task with a prompt in one project and then opens Create Task in another project
- **THEN** the second project's dialog does not show the first project's prompt
- **AND** returning to the first project restores its own prompt

#### Scenario: Restart discards retained drafts
- **WHEN** the application is restarted after a Create Task draft was retained
- **THEN** Create Task opens with an empty prompt

### Requirement: A supplied prompt seed supersedes a retained draft

When Create Task is opened with a supplied prompt seed, the dialog SHALL present the seed and SHALL NOT present the retained draft. The retained draft SHALL NOT be silently merged into the seeded prompt.

#### Scenario: Plugin composes a prompt over a retained draft
- **WHEN** a plugin opens Create Task with a prompt seed for a project that has a retained draft
- **THEN** the prompt shows the supplied seed
- **AND** the retained draft is not appended to or merged into it

### Requirement: Discard clears the draft without dismissing the dialog

Create Task SHALL offer a discard control that clears the prompt, its pasted images, and the retained draft for the current project, and SHALL leave the dialog open and ready for a new prompt.

#### Scenario: User discards a prompt
- **WHEN** the user activates the discard control in Create Task
- **THEN** the prompt is empty and its pasted images are removed
- **AND** the dialog remains open
- **AND** reopening Create Task later shows an empty prompt

### Requirement: Successful creation clears the retained draft

When Create Task successfully creates a task, the system SHALL clear the retained draft for that project so a later Create Task opens with an empty prompt. A failed creation SHALL retain the draft.

#### Scenario: Draft is cleared after creation
- **WHEN** the user successfully creates a task from Create Task
- **THEN** reopening Create Task for that project shows an empty prompt

#### Scenario: Draft survives a failed creation
- **WHEN** creation fails and the user then dismisses the dialog
- **THEN** the prompt is retained and restored on reopen

### Requirement: Editing an existing task keeps current dismissal behavior

The Create Task dialog in edit mode SHALL retain its existing dismissal behavior and SHALL NOT participate in draft retention.

#### Scenario: Edit mode dismissal is unchanged
- **WHEN** the user dismisses the dialog while editing an existing task's prompt
- **THEN** the dialog closes as it does today
- **AND** no draft is retained or restored for that task
