## Context

OpenForge currently derives Codex lifecycle from coarse hook events and a transcript monitor. `UserPromptSubmit` marks the Agent Session busy, and a transcript `task_complete` or `turn_aborted` record marks it ended. The hook bridge keeps only the current transcript turn ID in a temporary file and deletes that file when the transcript monitor reports the parent turn ending.

Codex can continue work in child agents after the parent turn has ended. It exposes `SubagentStart` and `SubagentStop` hooks with parent-turn and child-agent identities, but OpenForge does not install or process them. Separate hooks also run in separate Node processes, so child state cannot live only in process memory. In addition, Codex may deliver `PostToolUse` after the turn has ended. The generic lifecycle state machine treats that activity as busy and can therefore move a completed session back to running.

The existing lifecycle endpoint already rejects notifications for a replaced PTY instance. The Codex hook bridge can build on that boundary while owning the provider-specific meaning of parent turns and child agents.

## Goals / Non-Goals

**Goals:**

- Keep a Codex Agent Session running until both its parent turn and every child agent for that turn have stopped.
- Make child tracking safe across independent hook processes and OpenForge restarts.
- Ignore stale or delayed activity from an ended turn.
- Preserve current completion behavior for turns without child agents, including transcript-detected capacity and interruption endings.
- Keep the lifecycle endpoint and public notification contract provider-neutral.

**Non-Goals:**

- Show individual Codex child agents in the renderer.
- Persist child-agent history in SQLite.
- Reconstruct child state for Codex sessions that were already running before the new hook profile was installed.
- Change lifecycle semantics for Claude, Pi, or other providers.

## Decisions

### Keep the coordination state in the Codex hook bridge

The installed Codex hook script will own a small state machine for the current PTY and turn. This keeps Codex-specific event names and ordering rules out of the generic lifecycle endpoint. The endpoint will continue receiving only `busy` and `ended` notifications and will retain its current PTY-instance fence.

The existing temporary turn file will become a versioned state document containing:

- the current Codex `turn_id`;
- whether the parent turn is active or ended;
- the set of active Codex `agent_id` values;
- an ordered outbox of lifecycle notifications awaiting acceptance.

The state remains keyed by Task and PTY instance. It will survive individual hook process exits and an OpenForge restart, but a replacement PTY naturally gets a different state key.

The script will retain an ended state as a tombstone until the next `UserPromptSubmit` instead of deleting it. This lets late tool hooks identify a settled turn and prevents them from reopening the Agent Session.

### Use hooks for activity and transcript records for confirmed endings

The generated Codex hook profile will add `SubagentStart` and `SubagentStop` entries that invoke the existing OpenForge hook script. Starts use the hook payload's `turn_id` and `agent_id` fields. `Stop` and `SubagentStop` are stop attempts, not confirmed endings: another matching Codex hook may block either event and continue the agent. The transcript monitor therefore confirms parent endings from terminal turn records and child endings from completed `SubAgentActivity` records.

Events will update lifecycle state as follows:

| Event | State change | Lifecycle notification |
| --- | --- | --- |
| `UserPromptSubmit` | Start a new active turn, or reactivate the same turn without discarding its children | `busy` |
| `SubagentStart` | Add the child to the current turn's active set | `busy` |
| `Stop` or `SubagentStop` | No confirmed state change | None |
| Parent transcript terminal record | Mark the parent ended | `ended` only if the active-child set is empty |
| Completed transcript child activity | Remove the child from the active set | `ended` only if the parent already ended and the set is empty |
| `PreToolUse`, `PostToolUse`, or `PermissionRequest` | No coordination-state change | `busy` only while the matching parent turn is active |

Duplicate child starts and confirmed endings are idempotent because active children are stored as a set. A child event missing either the parent-turn identity or child-agent identity is ignored for lifecycle purposes. An event for another turn is stale and does not mutate current state. A child may start another child after the root parent has ended; starts remain valid while any child for that turn is still active.

The transcript monitor remains alive until the parent and all tracked children are confirmed ended. A monitor exits early when a newer prompt supersedes its turn. It retains partial JSONL lines between polls so a growing transcript cannot lose a terminal record.

### Serialize state transitions across hook processes

Every turn-aware event will perform its read, decision, state write, and outbox append inside one lock-protected transition. State writes will use an atomic replacement so readers never observe a partially written document. The lock will include bounded stale-lock recovery to avoid permanently pinning a session after a hook process is killed.

Notification delivery uses a separate single-drainer lock and happens outside the state lock. Accepted entries are acknowledged and removed from the outbox; rejected entries remain for the next hook or transcript-monitor poll. Each outbox entry carries a stable notification ID, so a replay after process failure retains the ingress deduplication identity. This preserves event order without blocking concurrent child-state transitions on network retries.

If a stored state document is unreadable or has an unsupported version, only `UserPromptSubmit` may replace it. Other activity is ignored and logged rather than risking that a stale tool event reopens a settled turn.

### Treat a new prompt as the only start of a new turn

After a turn settles, `PreToolUse`, `PostToolUse`, and `PermissionRequest` cannot transition it back to running. A `UserPromptSubmit` for the same turn reactivates the parent while retaining its tracked children, covering a stop attempt blocked by another hook. A prompt with a new turn ID replaces the tombstone and emits `busy`. Events carrying the prior `turn_id` remain stale after that replacement.

`SessionStart` remains a coarse session-level signal for the existing startup flow, but it does not replace turn state or authorize a settled turn to reopen.

### Preserve the existing notification and storage boundaries

No database migration or public IPC change is needed. The hook bridge still posts the existing lifecycle notification shape, and the Rust lifecycle handler still owns Agent Session status changes and current-PTY validation. The provider-side state file is coordination data, not user-visible history.

This also means the feature benefits from the existing notification client and installed-hook regeneration path. Existing trust settings are preserved when the profile is regenerated, while the newly added hook entries may require Codex to confirm trust through its normal hook review flow.

## Risks / Trade-offs

- **A missing `SubagentStop` can leave a session running.** A new prompt or PTY replacement supersedes the stale state, but OpenForge will not guess that an unreported child stopped. This favors avoiding false completion while Codex may still be working.
- **A killed process can abandon the coordination lock.** The lock includes owner metadata and bounded stale-lock recovery. Tests will cover recovery without allowing concurrent writers during normal execution.
- **Transcript child records are a compatibility dependency.** Codex hooks expose stop attempts before all blocking decisions are combined, so confirmed child completion currently comes from the parent transcript's `SubAgentActivity` record. If that internal record changes, OpenForge conservatively leaves the session running until a new prompt or PTY supersedes it.
- **An extended ingress outage can fill the bounded outbox.** Redundant non-terminal activity is dropped at the bound, while a terminal notification displaces non-terminal activity and is retained. This favors correct final state over activity detail.
- **Existing live sessions cannot be reconstructed.** Installation updates the hook profile for future events, but it cannot discover children that started before `SubagentStart` was registered. Starting a new prompt or session establishes authoritative state.
- **Transcript parsing remains a compatibility dependency for all confirmed endings.** The parser is deliberately narrow and tests the known parent and child record shapes. Missing records favor avoiding false completion.

## Migration Plan

1. Regenerate the managed Codex hook profile with `SubagentStart` and `SubagentStop` entries while preserving existing trust state.
2. Install the versioned coordination state machine in the managed hook script.
3. Let new prompts create the new state format. Existing legacy turn files are treated as unsupported state and replaced on the next prompt.
4. Verify Codex hook trust after installation and exercise a parent turn with multiple child agents.

Rollback restores the previous managed hook script and profile entries. Versioned temporary state files can remain in place because the previous script does not consume them, and a later reinstall can safely replace them on the next prompt.
