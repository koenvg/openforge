## Why

The review-prompt dialog requires a mouse click to send feedback after editing. A submit shortcut lets users finish reviewing and send without leaving the keyboard.

## What Changes

- Submit the open review-prompt dialog with Command+Enter on macOS or Ctrl+Enter on Windows/Linux.
- Send exactly the current draft through the same action as the Send to agent button, in either Address or Analyze mode.
- Preserve plain Enter for newlines and existing restrictions on empty drafts and busy agents.
- Show a platform-appropriate shortcut hint beside Send to agent.
- Keep the shortcut scoped to this dialog and ignore composition and repeated key events.

## Capabilities

### New Capabilities

- `review-prompt-submission`: Keyboard submission and shortcut discoverability for the review-prompt dialog.

### Modified Capabilities

None.

## Impact

- Renderer component `src/components/task-detail/SendToAgentPanel.svelte` and its component tests.
- Reuse the SDK Modal's existing `onKeydown` hook. No shared modal behavior changes, new dependencies, IPC changes, or backend changes.
- No changes to other dialogs, prompt generation, comment selection, or feedback dispatch semantics.
