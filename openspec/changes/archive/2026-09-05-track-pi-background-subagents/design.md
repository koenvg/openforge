## Context

See proposal.md, "Why", and `specs/pi-background-work/spec.md` for the required behavior.

OpenForge installs a small Pi extension from `src-tauri/src/pi-extension/openforge.ts`. The extension reports `input`, `agent_start`, and `agent_end` events to the generic Agent Lifecycle endpoint. Its current `agent_end` handler always reports `ended`.

Pi Subagents runs ordinary top-level delegation asynchronously by default. The parent Pi run can finish while a detached child continues, so `agent_end` does not mean the Task is done. Pi documents `agent_settled` as the boundary for status integrations and Pi Subagents documents `subagent:async-started` and `subagent:async-complete` as in-process lifecycle events for companion extensions. Started payloads identify the owning Pi session and the run's lifecycle directory. The session transcript also records `asyncId` and `asyncDir` in the subagent tool result, which makes reload recovery possible.

The two session identities have different forms. OpenForge persists Pi's `getSessionId()` value as the provider session ID, while Pi Subagents owns work by the parent session file path. The extension must retain both and never compare one form with the other.

## Goals / Non-Goals

**Goals:**

- Derive completion from both parent settlement and session-owned background work.
- Handle multiple concurrent background runs and completion events in any order.
- Recover active work after startup, reload, and session resume.
- Keep the existing generic Agent Lifecycle endpoint and database state machine unchanged.
- Degrade to ordinary Pi lifecycle reporting when Pi Subagents is absent or emits malformed data.

**Non-Goals:**

- Show child rows, progress, prompts, or results in OpenForge.
- Control, stop, steer, or resume subagents.
- Track foreground child calls, which already keep the parent run active.
- Add a hard timeout for background work or replace Pi Subagents' own terminal-state decisions.
- Generalize this change into a provider-neutral background-work protocol.

## Decisions

### Report final state from `agent_settled`

Replace completion reporting from `agent_end` with reporting from `agent_settled`. At settlement, reconcile known runs and report:

- `became_busy` when at least one session-owned run is active;
- `ended` when none remain.

Keep `agent_start` and `input` reporting as they are. This avoids transient completion during Pi retries, compaction retries, and queued continuations even when no subagent is involved.

Alternative considered: keep `agent_end` and only special-case active subagents. Rejected because Pi explicitly documents `agent_settled` for status integrations, and the old boundary can also fire before other automatic continuation paths.

### Track documented Pi Subagents lifecycle events without importing the package

Subscribe through `pi.events` using the documented `subagent:async-started` and `subagent:async-complete` channel names. Keep a map keyed by run ID with the owning session file and lifecycle directory.

A start event is accepted only when it contains a bounded non-empty run ID, a bounded lifecycle directory, and a session ID equal to the current Pi session file. A completion event removes only the matching run owned by the current session. Events for another or previous session are ignored.

The OpenForge extension will not import `pi-subagents`. Its installed location does not share a dependable Node resolution path with user Pi packages, and OpenForge must still load when Pi Subagents is absent. The event contract is process-local and optional, so string channel names keep the integration dependency-free.

Alternative considered: use the exported `pi-subagents/background-work` registry. Rejected for this slice because that registry represents independently registered providers; Pi Subagents' own async runs are tracked separately and are not returned by its provider snapshot.

### Complete from the last child only when the parent is idle

When a completion event removes the final active run, inspect its documented `triggerTurn` flag as well as Pi's current idle state:

- if `triggerTurn` is true, keep the Agent Session running because Pi can still be idle in the interval before the completion notification starts the resumed parent run; that run's later `agent_settled` decides completion;
- if `triggerTurn` is false, Pi is idle, and no run remains, report `ended` immediately.

A process-terminal proof is earlier than semantic completion and does not carry `triggerTurn`. Reconcile its exact status artifact, but defer final completion briefly so the normal async-complete event can cancel that fallback. If the completion event is missing, the deferred check removes the terminal run and reports `ended` only when the same Pi session is still idle. Agent starts, settlements, session switches, and shutdown cancel stale deferred checks.

This prevents an async completion event or earlier process-terminal proof from racing a completion-triggered parent run and marking it completed before that resumed turn settles.

The intended flow is:

```text
parent starts ---------> running
     |
     +--> child starts
     |
parent settles
     |
     +--> child active -> became_busy
                         |
child completes --------+
     |
     +--> parent wakes -> started -> settled -> ended
     |
     +--> no wake ---------------------------> ended
```

### Recover active runs from the current session transcript

On `session_start`, inspect only the current session's entries for completed `subagent` tool results that contain `asyncId` and `asyncDir`. Treat those values as candidates, not proof of liveness. Read the versioned `status.json` beneath each recorded lifecycle directory and restore only runs whose stored session ID matches the current session file and whose state is `queued` or `running`.

Use every distinct candidate recorded in the current session so an older active run cannot be hidden by newer terminal results. Bound recovery through limited read concurrency and a fixed maximum byte count per regular `status.json` file. Do not recursively scan temporary directories or infer ownership from process IDs. Ignore missing, non-regular, oversized, terminal, malformed, unsupported-version, or unreadable artifacts. Live start events remain authoritative until a matching completion event, so a temporary status read failure must not discard a run already observed in this extension instance. When recovery restores any active run, immediately report `became_busy` so reload or resume corrects a stale persisted completion state without waiting for another Pi settlement.

Alternative considered: keep event state only in memory. Rejected because Pi reloads extension instances while detached children can continue running.

Alternative considered: scan Pi Subagents' temporary root. Rejected because it would enumerate unrelated sessions, couple OpenForge to directory discovery rules, and weaken ownership checks.

### Keep lifecycle transport and persistence unchanged

The extension continues posting ordinary `AgentLifecycleNotification` payloads to `/hooks/agent-lifecycle`. Existing PTY instance and provider session checks remain authoritative. No new backend payload fields, database columns, renderer state, or public IPC methods are needed.

## Risks / Trade-offs

- [Pi Subagents changes its documented event or artifact contract] -> Validate event payloads and lifecycle artifact versions, ignore unsupported data, and retain ordinary Pi behavior.
- [A completion event races the parent wakeup] -> Check `ctx.isIdle()` before reporting completion and let `agent_settled` resolve an active parent run.
- [An extension reload occurs before the start event is observed] -> Reconstruct candidates from current-session tool results and verify their status artifacts.
- [A lifecycle artifact is temporarily unreadable during recovery] -> Ignore it without breaking Pi lifecycle reporting; a later start or parent event can restore running state, but the Task may briefly under-report work.
- [Old session events arrive after a switch] -> Require exact session-file ownership for starts, completions, and recovered status.
- [A run terminates without a completion event] -> Reconcile tracked status artifacts at settlement and relevant terminal notifications while retaining live event state on read failure.

## Migration Plan

1. Ship the updated Pi extension source with the desktop application.
2. Let the existing startup installer overwrite the installed OpenForge Pi extension as it does today.
3. Verify ordinary Pi completion, async child deferral, completion wakeup, multiple children, and reload recovery in automated tests.
4. Drive a real Task through an asynchronous Pi subagent handoff and confirm its Agent Session stays running for the full interval.

Rollback requires restoring the previous bundled extension source. No stored data or schema rollback is needed.
