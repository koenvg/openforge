## Why

Task Browser users need live-page comments to match the configured OpenForge theme and support quick removal without leaving page context. Live validation also showed that selection concealment must remove the whole card rather than only its container styling.

## What Changes

- Add a host-owned visual-feedback card in the lower-right corner of the current Task Browser page when that exact URL has unsent annotations.
- Show the current page's annotations in number order with a count and readable comment text.
- Match the card to the configured OpenForge light or dark theme and update it when the configured theme changes.
- Let users delete an annotation from its card row through the plugin's existing authoritative draft-deletion workflow.
- Expand the card when it first appears and allow the user to collapse or reopen it.
- Remove the entire card from rendering, hit testing, and accessibility exposure during region selection and captured evidence.
- Keep sending, editing, undoing, persistence recovery, capture management, and cross-page review in the existing Task Browser plugin controls.

## Capabilities

### New Capabilities

- `task-browser-visual-feedback`: Defines how current-page visual-feedback comments are presented, themed, and deleted from the live Task Browser page.

### Modified Capabilities

None.

## Impact

- Affects the Electron-owned Task Browser visual-feedback overlay, Browser Surface SDK and IPC contracts, Task Browser plugin draft handling, and their focused tests.
- Adds configured visual-feedback appearance data and a host-to-plugin annotation-action event without moving durable draft ownership into Electron.
- Preserves the Task Browser plugin's existing persistence, capture ownership, Agent delivery, and full review behavior.
