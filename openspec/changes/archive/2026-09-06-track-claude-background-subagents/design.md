## Context

See proposal.md, "Why", for motivation.

Current state. Claude's `Stop` hook posts to OpenForge's local HTTP bridge. `deferrable_background_work` replays the session transcript and returns the work it believes is still pending. `hook_routes.rs` then rewrites the lifecycle event: a non-empty list turns `Ended` into `BecameBusy`, which is the entire mechanism for keeping a task marked running past the agent's turn. `DeferredCompletionWatcher` schedules the eventual completion.

The transcript replay recognises exactly two result shapes, keyed on undocumented `toolUseResult` field names. Sampling 204 local transcripts, 385 MB, found four in practice:

| Kind | Result field | Recognised | Samples |
| --- | --- | --- | --- |
| backgrounded shell | `backgroundTaskId` | yes | 1136 |
| armed monitor | `taskId` | yes | 234 |
| async subagent | `agentId`, `isAsync: true` | no | 202 |
| synchronous subagent | `agentId`, no `isAsync` | n/a, already finished | 3 |

Claude 2.1.259 declares `background_tasks` on the `Stop` payload with entries of `{ id, type, status, description, command?, agent_type?, server?, tool?, name? }`. Its own description states the field exists so hooks can tell a finished session from one paused waiting for background work.

Reading the 2.1.259 build settles three things the earlier draft of this design left open. The emitted array is pre-filtered: an entry appears only when its status is `running` or `pending` and it is not explicitly foreground. The builder walks the whole task registry with no cap, so a short list is a complete list. And `type` is a display label mapped from an internal discriminant:

| Internal | Reported `type` |
| --- | --- |
| `local_bash` | `shell` |
| `local_agent` | `subagent` |
| `local_workflow` | `workflow` |
| `monitor_mcp`, `monitor_ws` | `monitor` |
| `mcp_task` | `MCP task` |
| `in_process_teammate` | `teammate` |
| `remote_agent` | `cloud session` |
| `dream` | `dream` |
| `auto_mode_scan` | `auto-mode scan` |

So a non-empty inventory means work is outstanding, with one exception handled below.

Constraint: OpenForge supports Claude builds that predate the field, so the transcript path cannot be deleted.

## Goals / Non-Goals

Goals:
- One decision point that answers "is background work outstanding", fed by the best evidence available for the running agent build.
- Cover every kind the inventory reports, including kinds not yet seen, without a code change per kind.

Non-Goals:
- Removing the transcript replay. It stays as the fallback.
- Reworking `DeferredCompletionWatcher` or the grace period. See Risks.
- Per-subagent visibility in the UI. This change only decides whether the parent task is running.
- Reacting to subagent start and stop hook events. Those exist and would give live child rows, but they are a separate capability.

## Decisions

### Prefer the reported inventory, fall back to transcript replay

The inventory is a declared payload schema with described fields and a stated purpose. Transcript replay reconstructs the same answer from internal result shapes that already vary between builds. Where both are available the inventory wins.

Alternatives considered. Transcript replay only, extended with the subagent shape: cheapest, but needs another branch for `workflow` and for every kind added later, each discovered by a task going grey in production. Inventory only: leaves older builds worse off than today, since they would lose shell and monitor coverage too.

The fallback triggers on the field being absent, not on it being empty. An empty array is a positive statement that nothing is in flight.

### Still teach the transcript replay about subagents

The fallback would otherwise stay blind to the exact case this change is named for on any build that does not report the inventory. Registering on `agentId` with `isAsync: true` is a small addition and it makes the two paths agree on subagents.

### Model a pending subagent as expiring rather than as a running command

The existing liveness model has two arms: match a command in the process tree, or hold until a declared expiry. A subagent runs inside the agent process, so there is no command to match, and it declares no timeout. It therefore takes the same arm as a persistent monitor: no declared expiry, ended by its own stop announcement.

Alternative considered: polling the mtime of the agent's per-subagent transcript under `<session>/subagents/agent-<id>.jsonl`, which does track activity. Rejected because it buys nothing under the current watcher. The watcher wakes once, at the grace deadline, and by then the answer is the same either way. It would also couple OpenForge to an undocumented on-disk layout.

### Teammate entries are excluded

`in_process_teammate` covers long-lived teammates that stay registered while parked between turns, so their entry can read `running` when nothing is actually working. Counting them would pin a task running for the full grace window on every turn of any session that ever spawned one. They are dropped before the decision.

The cost is that a genuinely working teammate does not hold the task open. That is the right trade until subagent and teammate lifecycle hooks are wired up, which is where per-child state belongs. Excluded by reported `type`, so an unrecognised future teammate-like kind still counts as running by the rule below.

Alternative considered: counting every entry uniformly, no type allowlist. Simpler, but one parked teammate breaks completion for the whole session.

### Unrecognised kinds count as running

The inventory's `type` falls back to a raw discriminant for kinds the agent does not name, so an unknown value means "something new", not "nothing". An entry counts unless its state is explicitly neither `running` nor `pending`.

That state check is redundant against the current build, which filters those out before emitting, and it stays anyway. It costs one comparison and it is the only thing standing between a future build that moves the filter and a host that silently completes live sessions. The failure mode of guessing wrong in this direction is a task marked running slightly too long, against a task going grey while work continues, which is the bug being fixed.

### Nothing changes about how work ends

Backgrounded subagents already announce completion through the same notification block the existing terminator parses, under the same identifier namespace. Verified against real transcripts.

## Risks / Trade-offs

Two sources of truth for the same question, and they can disagree → The inventory always wins when present. The transcript is never consulted alongside it, not at the hook and not later. The deferral carries its own source so the watcher does not quietly replay the transcript at the grace deadline, which would let work the inventory omitted extend a deferral it never authorised.

A reported `Monitor` loses its declared timeout → Accepted, and it is a regression against the transcript path. The inventory carries no timeout field, so every reported item defers to the grace deadline. A monitor armed for two hours now completes at ten minutes and flips back when it fires, where transcript replay would have held it for the full two hours. Recovering the timeout means reading the transcript for entries the inventory already listed, which is exactly the reconciliation this design rules out. Same shape as the silent-subagent limit below, same escape hatch.

A silent subagent outliving the grace period still completes the task early → Not fixed here. The watcher fixes its grace deadline once per turn, so a subagent that runs longer than the configured grace, currently ten minutes, with no other hook traffic still flips the task to completed and back. The window re-arms on every turn, so a fan-out whose members report at intervals never hits it. A single long silent subagent does. The existing `claude_background_work_grace_seconds` config is the operator escape hatch. Worth a follow-up change, not worth blocking this one.

A subagent resumed after it already announced a stop is not re-registered by transcript replay → No fix on the transcript path; a resume leaves no start marker to find. The inventory covers it whenever it is present, which is the common case going forward.

A malformed inventory could reject the whole hook → The hook payload is deserialized strictly, so a typed model would fail the request and the lifecycle event would never be recorded. The field is read as untyped JSON instead. An inventory that is not a list reads as absent and falls back to the transcript.

An unreadable entry could silently empty the inventory → An entry counts as outstanding unless it names itself a teammate or reports a state that is not in flight. Nothing else disqualifies it. Dropping entries whose fields cannot be read would mean one renamed key turns every inventory into an empty one, the caller trusts it as authoritative, the fallback never runs, and every task with a live subagent goes grey. That is the bug this change exists to fix.

Excluding teammates could hide real work → Accepted. A working teammate does not hold the task open. Revisit when subagent and teammate lifecycle hooks land.

The inventory reports work for the whole session, not per task → OpenForge already scopes hook events per task through the task id carried on the hook URL, and a Claude session belongs to one task. No new scoping needed, but worth a test.

## Migration Plan

No migration. No stored state, no schema change, no contract change. Behaviour is decided fresh on each `Stop` hook from the payload in hand.

Rollback is reverting the commit. Older Claude builds exercise the fallback path continuously, so both paths stay live in normal use rather than one rotting untested.

## Open Questions

None. The truncation question the earlier draft deferred is answered above: the builder is uncapped.
