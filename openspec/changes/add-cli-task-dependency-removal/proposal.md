## Why

The OpenForge CLI can add or replace task prerequisites but cannot remove one or clear the list. KVG-5232 is still blocked by KVG-5266 even though completed-task tracking moved to KVG-5268, which depends on both tasks. Agents need an explicit way to correct that link without discarding unrelated prerequisites.

## What Changes

- Add `openforge task dependencies remove --task-id <id> --depends-on <task-id>` to remove one direct prerequisite.
- Add `openforge task dependencies clear --task-id <id>` to remove all direct prerequisites. Keep `set` non-empty so an omitted argument cannot clear a list by accident.
- Document the commands and verify their behavior for missing tasks, absent links, and empty arguments.
- Keep native dependency persistence and validation. No Codex Usage plugin changes are included.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-dependency-removal`: Extend atomic single-relationship removal to the CLI and specify explicit clearing of a task's direct prerequisites.

## Impact

The OpenForge CLI command/help files and task-management skill, the Rust sidecar's local HTTP task route, and their tests. The existing database operations remain authoritative. The running app must be updated before the new command can remove KVG-5232's live link to KVG-5266.
