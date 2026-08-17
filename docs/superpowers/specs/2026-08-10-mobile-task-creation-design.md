# Mobile Task Creation — Design

## Goal

Allow a paired OpenForge Mobile Companion device to capture a new Task while away from the desktop without expanding the mobile surface to desktop Task-configuration parity.

## Product decisions

- Creation is scoped to the currently selected, visible Project.
- The only user-supplied field is the Task initial prompt.
- Submission creates a Backlog Task. Starting it remains a separate explicit action from Task detail.
- Provider, permission mode, worktree behavior, code-cleanup behavior, and other runtime settings resolve from desktop-saved Project defaults.
- Labels, dependencies, title, source ticket, attachments, prompt editing, and Project selection inside the composer remain out of scope.
- Existing and newly approved paired devices inherit creation authority without re-pairing, consistent with ADR 0016.

## Companion contract

`POST /companion/v1/projects/{projectId}/tasks` accepts `{ "initialPrompt": string }` and returns the created Task identifier, Project identifier, and authoritative `backlog` Board status.

The gateway authenticates the paired device, verifies that the Project is visible, rejects blank or malformed prompts, creates through the desktop database boundary, and publishes the normal Task-created App Event so Board resources invalidate. The response exposes no filesystem path, runtime configuration, provider data, or generic command capability.

Task creation is a single-attempt mutation. The mobile client must not automatically retry or fail over to another endpoint after an uncertain transport result.

## Mobile interaction

The loaded Project Board exposes one **New Task** floating action. It opens a focused bottom-sheet composer with a visible initial-prompt label, explanatory text, Cancel, and one primary **Create Task** action.

While submitting, the form is disabled and shows progress. After success, mobile refreshes the selected Project Board, selects Backlog, closes the composer, and opens the created Task detail. If the response is lost, mobile refreshes Backlog and keeps the composer open with: “Task may have been created. Check Backlog before retrying.”

## Out of scope

- Create-and-start as one operation
- Automatic mutation retries or offline queues
- Cross-Project creation from the composer
- Desktop Task-form parity or post-creation editing
- New per-device scopes, renewed consent, or biometric approval
