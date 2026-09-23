## Context

See [proposal.md](proposal.md) for motivation and [the delta spec](specs/task-dependency-removal/spec.md) for behavior. The Rust database already provides transactional `remove_task_dependency` and `set_task_dependencies` operations. The CLI sends add/set/link requests to the sidecar but has no remove or clear command; CLI `set` rejects empty parsed ID lists.

## Goals / Non-Goals

**Goals:**
- Expose the existing atomic single-link removal operation to the CLI without a read/modify/write race.
- Make full-list clearing an explicit command while keeping accidental empty `set` requests invalid.

**Non-Goals:**
- Changing database schema or dependency validation rules.
- Editing the Codex Usage plugin or changing the task board UI.
- Automatically changing live task relationships as part of installing this change.

## Decisions

- **Use native single-link removal behind a new local HTTP route.** The route delegates to `Database::remove_task_dependency`, then emits the standard task-changed event and update response. A CLI read followed by `set` could erase an unrelated prerequisite added in between; the database operation deletes just the named link in one transaction. The existing database operation rejects a missing current task and treats an absent link as a no-op.
- **Route `clear` through the existing native `set_task_dependencies` endpoint with an empty array.** It already validates the current task and accepts an empty list atomically. A separate clear backend operation would duplicate persistence logic; allowing an empty `set` CLI argument could turn a typo into an unintended clear. The command parser therefore keeps `set` non-empty and gives `clear` its own flag contract.
- **Test at command and native HTTP boundaries.** CLI bridge tests verify exact requests and argument rejection; sidecar HTTP tests verify that removal preserves other links and both operations reject a missing task. Existing database tests cover idempotence and transactional behavior. Help text, the installed CLI skill, and the contributor guide document both commands.

## Risks / Trade-offs

- [The CLI can be updated before the sidecar] → The remove request fails until the matching sidecar is installed; deploy them together and do not fall back to read/modify/set.
- [A caller clears a task with no prerequisites] → The native set operation succeeds with an empty list. This is deliberate and keeps `clear` repeatable.
- [Removing an unknown prerequisite ID] → Native removal succeeds as a no-op when the current task exists. Documentation distinguishes this from an unknown current task, which fails.

## Migration Plan

No database migration is needed. Ship the CLI and sidecar together. Once the running app has been updated, confirm KVG-5232 still depends on KVG-5266 and run `openforge task dependencies remove --task-id KVG-5232 --depends-on KVG-5266`; verify that KVG-5268 retains its two prerequisites. Rolling back the app removes these commands but does not restore a relationship already removed. Re-add a relationship explicitly if that is desired.
