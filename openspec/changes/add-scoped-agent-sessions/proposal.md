## Why

`add-core-review-threads` deferred plugin-owned agent sessions to a following change. This is that change.

Every live Agent Session belongs to a Task. `CONTEXT.md` defines an Agent Session as the provider conversation or PTY attached to an Implementation Run, and an Implementation Run is task-scoped. The storage matches: `agent_sessions.ticket_id` and `task_workspaces.task_id` are both non-null and reference `tasks(id)`, the agent PTY key is the task id, and the renderer keeps one live session per task id. A plugin that owns a subject which is not a Task therefore cannot run an agent the user can watch or talk to. Its only option is a headless generation with no visible output, no history, and no follow-up.

Review Threads already solved the same addressing problem with an opaque namespace, target key, and revision triple that core stores and compares but never interprets. Agent Sessions need the same addressing.

## What Changes

- Introduce a Session Scope: an opaque namespace, target key, and revision triple chosen by a plugin and only stored and compared by the host. It follows the Review Thread Scope convention, so a subject's threads and its session share one address.
- Introduce a Scoped Agent Session: a live agent session addressed by a Session Scope and attached to no Implementation Run. This is a domain change, so `CONTEXT.md` gains the new terms and states that an Agent Session is no longer always task-owned.
- Store Scoped Agent Sessions separately from task-owned Agent Sessions. `agent_sessions`, `task_workspaces`, and `worktrees` are unchanged, and so are the board, attention counts, task completion, and startup resume.
- Introduce a Scoped Workspace: the host creates, reuses, and removes the directory a Scoped Agent Session runs in. A plugin names a repository and a revision and never creates or cleans up a checkout itself. One workspace per scope and revision, reused across the turns of a session, removed when the revision changes or the plugin releases the scope, and bounded so abandoned checkouts cannot grow without limit.
- Introduce a Session Tool Policy: a named policy the host owns and enforces, which a plugin selects by name. This generalizes the sidecar's internal headless tool policy into a per-session contract. A read-only policy is enforced by a host-written permission deny list, because an interactive session asks the user for approval and the user can grant it, so a permission mode alone is not a guarantee.
- Add a host-rendered session terminal a plugin mounts for a scope. The host keeps PTY spawn, input, resize, kill, replay, and restart reconciliation.
- Extend the existing list-only `agentSessions` SDK surface with scope-addressed start, input, status, change events, and abort. Task-scoped listing keeps its current behavior.
- Allow one live session per scope, mirroring one live session per Task, and bound concurrent sessions host-wide with an explicit queued state rather than an unbounded wait.

Rejected alternative: a hidden Task per subject, which `add-core-review-threads` named alongside plugin-owned sessions. It needs no schema change, but it puts an exclusion clause on every query that lists Tasks, permanently.

Out of scope, deliberately:

- Scoped sessions in the Focus board, attention counts, in-flight task views, or startup resume. Revisit once the surface has a consumer in use.
- Raw provider command-line flags, a PTY handle, a plugin-owned workspace, or any other direct access to host terminal internals reaching a plugin.
- Any change to task-owned Agent Session storage, addressing, or lifecycle.

## Capabilities

### New Capabilities

- `scoped-agent-sessions`: Session Scope addressing, Scoped Agent Session lifecycle, Scoped Workspace ownership and cleanup, Session Tool Policy enforcement, the host-rendered session terminal contract, and the limits that bound both.

### Modified Capabilities

- `plugin-agent-sessions`: the plugin Agent Session surface stops being list-only and gains scope-addressed start, input, status, and abort. Existing task-scoped listing behavior stays compatible.

## Impact

- Sidecar storage: new scope-addressed session and workspace tables and their queries. No change to `agent_sessions`, `task_workspaces`, or `worktrees`.
- Sidecar session lifecycle: provider launch, PTY spawn, follow-up delivery, abort, and terminal replay for an owner that is not a Task.
- Sidecar git worktree management: checkout creation and removal keyed by scope and revision instead of by task.
- Provider invocation: the host-written settings file that carries the Session Tool Policy deny list.
- Terminal Runtime Shell Session Key parsing, in both the renderer package and its Rust counterpart. The existing agent and indexed-shell key shapes live only in code, so a third shape must stay unambiguous against both. `preserve-sessions-across-updates` also touches the Terminal Runtime and lands first or coordinates.
- Public plugin SDK: types, the `agentSessions` surface, the testing fake, the packaged plugin-host runtime, and authoring documentation.
- `CONTEXT.md` Language section.
- Renderer: a host terminal a plugin can mount for a scope, separate from the task-keyed live session store.
