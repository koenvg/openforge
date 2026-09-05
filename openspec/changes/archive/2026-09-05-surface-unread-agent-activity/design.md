## Context

See `proposal.md` for the user problem. Task Attention is currently a backend-owned projection derived from the latest Agent Session, pull requests, per-project Focus state configuration, and the manual Out of Focus list. Once a session stops, pull request state takes precedence over `agent-done`; states such as `review-pending` and `ci-running` normally remain in In Flight.

The renderer receives `TaskAttentionRow` records through typed desktop IPC and uses the same projection for Focus membership, cross-project attention counts, the board, and the Attention Overview. Task Detail keeps the Agent pane mounted while other panes are selected, so mount state alone cannot mean that output was seen.

## Goals / Non-Goals

**Goals:**

- Represent workflow state and unread agent output independently.
- Record a new unread output revision whenever an Agent Session enters completed, paused, failed, or interrupted state.
- Acknowledge only the exact output revision that was visible to the user.
- Keep Task Attention authoritative in the backend and consistent across restarts and projects.
- Preserve enough workflow context to explain why a read task remains in Focus or returns to In Flight.

**Non-Goals:**

- Parse terminal text to identify the final assistant message.
- Track which lines within a terminal replay were read.
- Change pull request readiness rules or configurable Focus states.
- Override the user's manual Out of Focus choice. Set-aside tasks retain their lane but still carry and display unread state.
- Add notification preferences or a manual "mark unread" action.

## Decisions

### Store monotonic read revisions on each Agent Session

Add two non-negative integer columns to `agent_sessions`:

- `output_revision`, initially `0`
- `viewed_output_revision`, initially `0`

The persistence layer increments `output_revision` atomically when the stored status changes into `completed`, `paused`, `failed`, or `interrupted`. Returning to `running` does not increment it. This supports repeated follow-up turns in the same Agent Session:

```text
running --> completed revision 1 --> running --> completed revision 2
                    ^ read 1                         ^ unread 2
```

Output is unread when the latest session is stopped and `output_revision > viewed_output_revision`. Existing sessions migrate with both values at zero, so upgrading does not make historical work appear unread.

The revision update belongs in the database status-transition path. Direct SQL paths that interrupt or finalize sessions must use the same rule. Duplicate lifecycle notifications that do not change stored status must not increment the revision.

Alternatives considered:

- Timestamps were rejected because session timestamps have second-level precision and cannot safely order a new response against a concurrent acknowledgement.
- A task-level boolean was rejected because it cannot distinguish repeated turns or prevent a stale acknowledgement from clearing newer output.
- Terminal replay timestamps were rejected because paused and failed sessions do not all produce the same replay lifecycle.

### Keep unread output separate from workflow state

Extend the shared Agent Session and Task Attention projections with revision and unread metadata rather than adding a synthetic `agent-unread` task state. The existing task state continues to describe the underlying work, such as `review-pending`, `ci-failed`, or `needs-input`.

For tasks not manually set aside, Focus membership becomes:

```text
has unread agent output
OR
underlying state matches the existing Focus rules
```

This gives the required fallback after acknowledgement:

```text
Underlying state       Unread    Displayed lane
------------------------------------------------
review-pending          yes       Focus
review-pending          no        In Flight
ci-running              yes       Focus
ci-running              no        In Flight
ci-failed               yes       Focus
ci-failed               no        Focus
needs-input             yes       Focus
needs-input             no        Focus
```

Out of Focus remains a manual lane override. Its rows still expose unread metadata, so the state is not lost or hidden when that lane is viewed.

A separate boolean such as `has_unread_agent_output` is added to `TaskAttentionRow`. The row's `state` and normal reason remain unchanged. This avoids coupling unread behavior to per-project Focus-state configuration and keeps pull request status visible.

Alternative considered: a new task state was rejected because it would hide the underlying workflow state, expand Focus configuration with a state that should not be optional, and make fallback placement harder to explain.

### Use revision-scoped acknowledgement

Add a typed desktop IPC command that accepts camelCase fields identifying the Task, Agent Session, and output revision that became visible. The database updates `viewed_output_revision` only for that matching session and never beyond the supplied revision.

If revision 2 arrives while a delayed acknowledgement for revision 1 is in flight, the stored values remain equivalent to:

```text
output_revision = 2
viewed_output_revision = 1
```

The task therefore remains unread. If a newer Agent Session has become current, acknowledging the older session cannot clear the newer session's output.

The command returns whether persisted state changed. After a successful change, the renderer refreshes Task Attention so board membership, the Attention Overview, and project badges update together.

### Acknowledge only when Agent output is actually visible

The Agent pane acknowledges the current revision when all of these conditions hold:

- Task Detail is showing that task.
- The active task pane is `agent`.
- The agent terminal attachment is ready.
- The document is visible and the application window has focus.

The same check runs when the user selects the Agent pane, when the window regains focus or visibility, when terminal attachment becomes ready, and when a newer stopped revision arrives while the pane is already visible.

Opening Task Detail on a restored Review, Terminal, or plugin pane does not acknowledge Agent output. Keeping the Agent component mounted behind another pane also does not acknowledge it.

Alternative considered: acknowledging on Task selection was rejected because Task Detail restores its last active pane and the user may never see the Agent output.

### Use one accessible unread treatment across task views

Task cards and Attention Overview rows show a compact visible label, `Unread agent output`, with a Lucide icon or dot. The Agent tab shows a small visual marker and exposes `Unread agent output` in its accessible name. Color supplements the label and accessible name rather than carrying meaning by itself.

Read Focus tasks keep their existing state and reason presentation without the unread label. No new lane or filter is added. Focus counts include all Focus tasks, including those brought there by unread output.

The renderer passes unread metadata through the existing components rather than deriving it from local navigation history. The Agent tab consumes the latest Agent Session revision data so it can issue a race-safe acknowledgement.

## Risks / Trade-offs

- [A provider emits an early idle event before all terminal bytes render] -> Require the terminal attachment to be ready and acknowledge only the revision supplied by the latest persisted session. Provider lifecycle characterization tests cover ordering.
- [Status writes bypass the revision rule] -> Centralize terminal transition bookkeeping in the database layer and add tests for lifecycle, finalization, startup interruption, and follow-up resume paths.
- [The pane is visible but the user has not read every line] -> Treat visible, focused output as read, matching common unread-message behavior. Per-line reading is outside scope.
- [Acknowledgement briefly leaves a card in Focus] -> Refresh the authoritative projection after persistence. Keep optimistic UI limited to the unread marker so lane placement still comes from the backend.
- [Shared SDK additions affect plugin fixtures] -> Add fields additively with explicit defaults in production and test adapters, then run package contract checks.

## Migration Plan

1. Add the two Agent Session revision columns with zero defaults.
2. Update Agent Session row mapping and shared TypeScript contracts.
3. Make all authoritative stopped-status transitions increment the output revision once.
4. Expose revision-scoped acknowledgement through typed desktop IPC.
5. Extend Task Attention and lane projections with unread metadata and override Focus membership for non-set-aside tasks.
6. Add Agent pane acknowledgement and unread presentation in Task Detail, the board, and Attention Overview.
7. Validate migrations, Rust lifecycle and projection behavior, IPC contracts, Plugin SDK contracts, and renderer interactions.

Rollback can ignore the additive columns and fields. Because migrated historical rows start at revision zero, no data backfill or destructive reversal is required.
