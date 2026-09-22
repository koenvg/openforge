## Why

On a phone, command and skill suggestions appear below the tall Create Task prompt field. Opening the keyboard can push the list out of view, so the user cannot easily see or choose a suggestion while typing its trigger.

## What Changes

- Show matching suggestions immediately above the prompt input, within the visible area of the Create Task sheet when the keyboard is open.
- Keep the suggestion list compact and scrollable on small screens while preserving readable names, descriptions, and touch targets.
- Preserve the provider-specific `/` and `$` triggers, filtering, and tap-to-insert behavior. Leave the rest of Create Task unchanged.

## Capabilities

### New Capabilities

- `mobile-task-prompt-suggestions`: Define where and how command and skill suggestions appear while entering a mobile task prompt.

### Modified Capabilities

None.

## Impact

The Flutter mobile companion's Create Task suggestion picker and widget tests are affected, primarily `apps/mobile_companion/lib/src/project_board/task_creation_sheet.dart` and `apps/mobile_companion/test/task_creation_sheet_test.dart`. No desktop prompt behavior, API contract, or new dependency is proposed.
