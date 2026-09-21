## Context

See `proposal.md` for motivation and `specs/scoped-agent-sessions/spec.md` plus `specs/plugin-agent-sessions/spec.md` for behavior.

The current ownership model is consistent but Task-only:

- `agent_sessions.ticket_id`, `task_workspaces.task_id`, and `worktrees.task_id` point at a Task.
- The task id is also the agent Shell Session Key. Indexed task terminals use `<task-id>-shell-<u32>`.
- Renderer state keeps the current session by task id, Task lifecycle owns cleanup, and startup resume searches Task workspaces.
- `agentSessions.list()` is a bounded historical query whose rows always contain Task attribution.
- Repo-aware headless generation has an internal tool policy and a temporary checkout, but no visible terminal and no durable conversation workspace.

Review Threads established the opaque `(namespace, targetKey, revision)` convention. A Session Scope uses the same three strings. Sharing a shape lets a plugin address one subject consistently, but it does not couple the Review Thread and session stores.

`preserve-sessions-across-updates` changes PTY ownership and reconciliation. Its design currently names two Shell Session Key shapes and preserves Task terminals. This change must extend that shared key contract without silently opting scoped sessions into restart preservation.

## Goals / Non-Goals

**Goals:**

- Add a non-Task Agent Session owner while leaving Task session tables and flows alone.
- Give one plugin-owned subject one visible, resumable session and one host-owned checkout at a revision.
- Make read-only an enforced policy even when the provider supports interactive approval.
- Keep terminal lifecycle, terminal state, and raw provider configuration inside OpenForge.
- Put finite limits on execution, waiting work, workspace count, and retained checkout bytes.
- Keep the public SDK, testing fake, frontend host, backend host, and packaged runtime on one contract.

**Non-Goals:**

- Show scoped sessions on the board, raise Task Attention, include them in task history, or restore them after app restart.
- Let plugins supply provider flags, permission modes, settings files, credentials, commands, checkout paths, or PTY keys.
- Change `agent_sessions`, `task_workspaces`, `worktrees`, Task start, Task follow-up, or `agentSessions.list()` results.
- Preserve a scoped session across plugin disablement, uninstall, normal Quit, or a coordinated app replacement.
- Add a general plugin process API or terminal API.

## Decisions

### 1. Add four domain terms and keep Task ownership explicit

Add these entries to the Language section of `CONTEXT.md`:

- **Session Scope**: the opaque namespace, target key, and revision triple that addresses a Scoped Agent Session. The host stores and compares the strings and does not interpret the subject.
- **Scoped Agent Session**: an Agent Session owned by a Session Scope rather than by an Implementation Run.
- **Scoped Workspace**: a host-owned repository checkout for one Session Scope and resolved revision, reused across that session's turns.
- **Session Tool Policy**: a named host rule set that fixes which tools and host routes a Scoped Agent Session can use.

Revise **Agent Session** to say that the provider conversation or PTY belongs either to an Implementation Run or to a Session Scope. Keep **Implementation Run** task-scoped.

Add these invariants to the Concepts and relationships section:

- An Implementation Run still uses exactly one Task-owned Agent Session.
- A Scoped Agent Session belongs to exactly one Session Scope and no Implementation Run.
- One live Scoped Agent Session may exist per Session Scope.
- A Scoped Workspace is host-owned and can outlive one provider process so the next turn can reuse it.
- A plugin selects a Session Tool Policy by name and cannot widen it with provider options or user approval.

This wording matters. Calling every session an Implementation Run would make the supposedly general concept Task-scoped again.

### 2. Store scoped sessions and workspaces separately

Add `scoped_agent_sessions` and `scoped_workspaces`. Do not make `agent_sessions.ticket_id` nullable and do not add a synthetic Task foreign key.

`scoped_agent_sessions` stores:

```text
id
owner_plugin_id
namespace, target_key, revision
project_id, checkout_revision, resolved_commit
provider, provider_session_id
tool_policy
terminal_key, pty_instance_id
status, queue_sequence, error_code, error_message
created_at, updated_at, last_used_at
```

`scoped_workspaces` stores the same scope triple, Project and resolved commit, host path, measured bytes, cleanup state, and timestamps. A unique index covers the scope triple. Another index on `(namespace, target_key)` finds the older revision during rotation.

The creating plugin owns the logical `(namespace, targetKey)` while a scoped record exists. Plugin identity is authorization metadata, not a fourth public scope field. Another plugin using the same triple or another revision of that logical target gets an ownership error. Review Threads stay shared according to their own contract; sharing an address does not grant session control.

Start for a new revision first aborts and releases the owner's older revision. This serializes checkout cleanup and prevents two conversations for one changing subject.

Alternative considered: make the existing foreign keys nullable and add scope columns. Rejected because every Task query and lifecycle update would gain a second owner branch, and database constraints could no longer state which owner is required without a broad table rewrite.

### 3. Resolve repositories through Projects and own the checkout

The start request carries `projectId` and `checkoutRevision`, not a repository path. The host resolves the Project repository, fetches when needed, resolves the requested revision to a commit, and creates a detached worktree under a dedicated application-data root. The Session Scope revision stays opaque; `checkoutRevision` is the separate git input the host is allowed to interpret. A pull request consumer normally passes the same commit SHA to both.

Creation uses a staging directory and a database reservation. Only a complete, measured checkout is renamed into its final host path and marked ready. Fetch, resolution, checkout, measurement, or publication failure removes the worktree registration, staging directory, credential, and reservation before returning an error.

Later turns use the same resolved commit. Read-only sessions should not change the checkout, so capacity eviction can remove an inactive directory without losing session state. If the user continues that session later, the host recreates the worktree at the stored commit before resuming the provider conversation.

Workspace retention has two simultaneous ceilings:

- 32 published Scoped Workspaces.
- 20 GiB of logical regular-file bytes below those workspace roots. Measurement does not follow symlinks and excludes the repository's shared git object store.

Before publication, evict inactive workspaces in ascending `last_used_at` order until both ceilings hold. A workspace is protected while its session is queued, starting, running, or paused. A single checkout larger than 20 GiB is removed and rejected. If protected workspaces consume the remaining budget, reject the new checkout rather than interrupt them.

Release, revision rotation, plugin disablement, plugin uninstall, and startup orphan reconciliation schedule deletion. Failed deletion remains `cleanup_pending` and the startup sweeper retries it. A pending directory still counts toward both ceilings until deletion succeeds.

Alternative considered: return a path and let the plugin create or remove the worktree. Rejected because plugins could escape the Project repository, race cleanup, retain credentials, and disagree with the session about which revision is running.

### 4. Use one durable lifecycle record and a bounded scheduler

The public states are:

```text
queued -> starting -> running <-> paused -> completed
   |          |          |          |          |
   +----------+----------+----------+-------> aborted
              +----------+----------+-------> failed
app replacement or lost host ownership ----------------> interrupted
```

`start()` validates scope ownership, Project access, the policy name, and provider support before it creates a row. If fewer than four scoped sessions hold execution slots, the row enters `starting`. Otherwise it enters `queued`. One monotonic `queue_sequence` gives a host-wide first-in, first-out order across plugins and windows.

Four is the host-wide scoped execution limit. `starting`, `running`, and `paused` hold permits. Task-owned sessions do not count toward it because changing Task capacity is outside this change. The queue holds 32 starts. A 33rd waiting request fails immediately and leaves no session or workspace. Queued work has no provider process and delays checkout creation until promotion, so the queue itself does not reserve 32 worktrees.

The initial prompt belongs to `start()`. `input()` is domain input, not a raw PTY handle:

- For a running or paused process, the provider adapter delivers or queues input through its ordered input path.
- For `completed`, the host reacquires an execution permit and workspace, then resumes the stored provider conversation in a new PTY instance under the same Shell Session Key.
- For `queued` or `starting`, input fails as not ready. For `failed`, `aborted`, or `interrupted`, it fails and tells the caller to release and start again.

Mounted terminal keystrokes use the same ordered PTY writer inside the host. A plugin never receives or forwards those bytes. Initial and later domain inputs are capped at 64 KiB of UTF-8 text. The host rejects larger input before storing or writing it.

`abort()` removes a queued row from scheduling or terminates the live owned process group. It records `aborted` and retains terminal state for reading. `release()` performs abort if needed, disposes terminal state, revokes credentials, removes both scoped rows, and schedules workspace deletion.

Normal process exit records `completed`; provider or host failure records `failed` with a stable error code and user-facing message. A completed session remains resumable. Scoped sessions never feed Task status, Task Attention, output acknowledgement, or task session listing.

Alternative considered: one process per API call with no durable session row. Rejected because a later question would have neither the provider conversation nor the terminal identity of the first turn.

### 5. Make the tool policy a final host authorization layer

The plugin passes a policy name only. Policy definitions live in a host registry and are immutable for a session. Widening a policy requires a new name or an explicit compatibility decision. The first policy is `review-read-only`.

`review-read-only` permits file reads, search, narrowly parsed read-only git commands, and named scope-bound host commands such as Review Thread submission. A Review Thread write is allowed because it changes host review data, not the checkout. The policy denies direct file mutation, unrestricted shell execution, process-spawning escape routes, and host commands outside the policy.

For Claude Code, the host writes a session-private settings file and excludes user and Project permission sources that could widen it. The generated settings carry the allow rules, an explicit deny list for mutation tools, and a host-owned pre-tool authorization hook for requests such as shell commands whose safety depends on their arguments. That hook parses a closed command grammar and denies shell operators, redirection, command substitution, and commands outside the allowlist. The host also gives the process a short-lived credential bound to the session id, owner plugin, and Session Scope. Scope-aware routes reject a request for any other scope even when its CLI arguments name one.

Interactive approval sits below this layer. Approval can satisfy a policy's `ask` decision, but it cannot change `deny` to `allow`. The final hook and host-route authorization run regardless of the approval response. Tests must exercise an edit request and a shell mutation after simulated user approval and prove that the checkout hash stays unchanged.

A provider adapter must prove that its deny mechanism and final hook cannot be bypassed by interactive approval. If it cannot, `start()` returns `UNSUPPORTED_TOOL_POLICY` before checkout or process creation. Initial delivery supports `review-read-only` for Claude Code; support for another provider is an additive adapter change.

Alternative considered: pass `--permission-mode manual` and rely on the user not approving a mutation. Rejected because the contract would stop being read-only at the exact moment the user clicked Approve.

Alternative considered: let plugins submit allow and deny lists. Rejected because policy review, provider differences, and future security fixes belong to the host, and callers must not be able to invent an unreviewed command channel.

### 6. Add an unambiguous third Shell Session Key grammar

Keep the current forms:

```text
<task-id>                    Task-owned agent
<task-id>-shell-<u32>        Indexed Task shell
```

Add:

```text
scoped-agent-v1-<64 lowercase hex characters>
```

The suffix is SHA-256 over a version byte followed by the three Session Scope fields encoded as length-prefixed UTF-8. Length prefixes prevent delimiter ambiguity, and the digest keeps event names and PID filenames bounded without leaking plugin target keys. Scope construction rejects empty strings, NUL, a namespace over 128 UTF-8 bytes, a target key over 2,048 bytes, or a revision over 256 bytes before hashing.

Both TypeScript and Rust parsers check the exact scoped grammar first, the existing indexed-shell suffix second, and otherwise preserve the string as a Task agent key. Product Task ids use an uppercase alphanumeric prefix of at most five characters plus a numeric suffix, so they cannot match the lowercase scoped grammar. Migration preflight checks existing Task ids for the reserved form before enabling scoped keys, and backend Task-prefix validation prevents direct configuration writes from creating that reserved form later. The scoped store also has a unique terminal-key constraint and rejects the theoretical case where one digest is already stored for a different triple.

The renderer and Rust implementation share fixture vectors for canonical bytes, digest, parse kind, and rejection cases. Existing key fixtures stay unchanged. Cleanup code switches on the parsed kind; Task deletion cannot match and kill a scoped session.

`preserve-sessions-across-updates` coordination is explicit:

- Extend its TypeScript, Rust, daemon protocol, inventory, PID registry, and diagnostics key types with `scoped-agent` after rebasing on its parser changes.
- Keep transport and terminal recovery generic over the key string, but classify the key before Task cleanup or restart workspace restoration.
- Scoped sessions remain outside restart preservation. Restart preparation aborts scoped processes, records them `interrupted`, and removes them from the daemon inventory before the handoff commits.
- A replacement Sidecar that finds a stray scoped key in daemon inventory quarantines and terminates it. It does not reinterpret it as a Task agent, restore a plugin view, or invoke provider resume.
- Restart workspace snapshots continue to contain only Task indexed-shell tabs. A scoped terminal mount is never serialized into that Task-shaped record.

Alternative considered: append another suffix to the raw scope strings. Rejected because target keys may contain the delimiter, long scopes would exceed filename limits, and the existing parser treats every non-shell string as a Task agent.

Alternative considered: use the raw Task key shape and add an owner lookup in the database. Rejected because the Terminal Runtime and daemon must classify keys without a synchronous SQLite lookup, especially during restart reconciliation.

### 7. Mount a host terminal instead of exporting terminal primitives

Extend the frontend Agent Sessions API with `mountTerminal(scope, element)`. It returns a disposable attachment. The backend entry point omits this DOM operation.

The mount manager creates a host-owned Svelte terminal component inside the supplied element. It gets an owner-scoped client from `src/lib/terminalSessionService.ts`, acquires the internal scoped key, restores replay before live output, filters all events by current `instance_id`, and owns resize and input routing. The plugin receives none of those objects.

One desktop attachment is current per Scoped Agent Session. A new mount increments an attachment generation and atomically replaces the previous one. Disposal carries that generation, so stale disposal cannot detach the new mount. Detach releases the view and geometry lease only. Session release, not component cleanup, releases the Terminal Session and kills the process.

The component compares Session Scope identity explicitly when props change. It does not release a prop-keyed session from `$effect` cleanup. `onDestroy` disposes the current attachment. This follows the repository lifecycle rule and prevents a Svelte rerun from killing a session another view just mounted.

Queued sessions render their queue state in the host component. Completed, failed, aborted, and interrupted sessions render retained output with input disabled unless the status says a provider continuation is available. `needsClear` remains a presentation signal and is never treated as liveness.

Alternative considered: return a PTY key and let the plugin use the Terminal Runtime. Rejected because it exposes an internal identity, lets plugins bypass owner-scoped cleanup, and makes every plugin reimplement replay, stale-instance filtering, resize leases, and teardown.

### 8. Extend the existing API without changing its list contract

The common SDK gains structurally typed operations along these lines:

```ts
interface SessionScope {
  namespace: string
  targetKey: string
  revision: string
}

interface StartScopedAgentSessionRequest {
  scope: SessionScope
  projectId: string
  checkoutRevision: string
  initialInput: string
  toolPolicy: string
}

interface AgentSessionsAPI {
  list(request: ListAgentSessionsRequest): Promise<AgentSessionSummaryPage>
  start(request: StartScopedAgentSessionRequest): Promise<ScopedAgentSessionState>
  status(scope: SessionScope): Promise<ScopedAgentSessionState | null>
  input(scope: SessionScope, input: string): Promise<ScopedAgentSessionState>
  abort(scope: SessionScope): Promise<ScopedAgentSessionState>
  release(scope: SessionScope): Promise<void>
  onDidChange(scope: SessionScope, handler: (event: ScopedAgentSessionChangeEvent) => void): Disposable
}
```

The frontend type adds `mountTerminal(scope, element)`. Frontend events remain coalescible invalidations scoped to the exact triple. Backend events carry state snapshots: ordinary state and output changes may coalesce, while provider-turn transitions are durably ordered and replayed so a later turn cannot hide an earlier turn's completion. State includes the stable scoped session id, lifecycle status, queue position and reason when queued, whether input is accepted, workspace availability, error code and message, and timestamps. It does not include the internal terminal key or host path.

Every host bridge supplies the caller plugin id from trusted invocation context. It never accepts that id from the request payload. CommonAPIFake implements the same defaults: four execution slots and 32 queued starts, duplicate-scope ownership, state transitions, and invalidations. Fake time and explicit completion helpers keep tests deterministic.

Existing `agentSessions.list()` keeps its Task-attributed database query and does not union scoped rows. The new store needs a separate diagnostic query if core needs one; changing the historical list shape would break its Task attribution promise.

### 9. Do not create a hidden Task per plugin subject

A hidden Task would reuse the current session code, but it would put an exclusion condition into every Task read and derived workflow:

- Focus, In-Flight Tasks, backlog, completed search, Task Attention, labels, dependencies, task counts, command palette, Companion, and startup resume would all need to omit it.
- Task deletion and plugin release would become coupled even though the subject belongs to a plugin.
- Task ids, prompts, status, Project membership, worktree choices, and completion semantics would exist only to satisfy foreign keys.
- A missed filter would leak an internal record into the user-facing Task model. New Task features would have to remember the exception forever.
- Multiple revisions of one plugin subject would either accumulate fake Tasks or overwrite Task identity in place.

That is more schema and product debt than two small owner-specific tables. More importantly, it says the wrong thing in the domain. A pull request review conversation is not implementation work the user put on the Task board.

## Risks / Trade-offs

- [Twenty GiB is too small for one repository checkout] → Reject the checkout with measured size and configured limit in the message. Changing the constant later is compatible; silently filling the disk is not.
- [Measuring a large staged checkout is expensive] → Measure once before publication, cache the result, and update it only after recreation. The read-only policy prevents ordinary session turns from changing the total.
- [A plugin never releases completed scopes] → The 32-workspace and byte ceilings evict inactive checkouts, while plugin deactivation and startup reconciliation clean orphaned sessions.
- [A queued plugin monopolizes waiting capacity] → Use one host-wide FIFO with a hard queue ceiling. Per-plugin fairness can be added later without changing the lifecycle states.
- [Provider permission behavior changes] → Keep the approval-path integration test as a provider adapter contract and reject an adapter that cannot prove final denial.
- [A permitted shell pattern admits metacharacter injection] → Parse a closed command grammar in the host hook and test separators, substitutions, redirection, and nested shells as denial cases.
- [Scope digest collision] → Store the original triple beside a unique terminal key and fail closed if the same digest maps to another triple.
- [Restart work lands concurrently] → Rebase the key work after `preserve-sessions-across-updates`, keep shared cross-language fixtures, and run daemon inventory and restart exclusion tests before enabling scoped launch.
- [A stale attachment kills or resizes a replacement] → Fence attach, detach, replay, output, exit, and resize with attachment generation and PTY `instance_id`.
- [Separate storage duplicates Task session code] → Share provider and terminal adapters below the owner-specific lifecycle layer. Do not share database rows or Task state transitions.

## Migration Plan

1. Add the domain language and cross-language third-key contract. Rebase it on the terminal and daemon changes from `preserve-sessions-across-updates`.
2. Add scoped workspace storage, staging, reuse, cleanup, measurement, and least-recently-used eviction without exposing it to plugins.
3. Add scoped session storage, the four-slot scheduler, the 32-entry queue, provider lifecycle, scope-bound credentials, and `review-read-only` enforcement.
4. Add the common SDK operations, host bridges, events, CommonAPIFake behavior, and generated or packaged contracts. Keep `agentSessions.list()` unchanged.
5. Add the frontend-only host terminal mount and exercise attach replacement, retained output, continuation to a new PTY instance, and teardown.
6. Run full validation for the database, Rust Sidecar and daemon protocol, desktop IPC and renderer, Terminal Runtime, Plugin SDK, generated runtime, and packaged contract.
7. Enable the later pull request consumer only after approval-path read-only tests and restart exclusion tests pass.

Rollback before a consumer ships removes the new API and tables after cleaning the dedicated workspace root. Once a Plugin SDK version publishes the additive operations, leave the types and explicit unavailable errors in place during rollback. Never reinterpret scoped rows as Tasks.
