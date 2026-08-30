## Context

See `proposal.md` for motivation and `specs/plugin-agent-sessions/spec.md` for behavior. `TasksAPI.listSessions()` currently requires a Task ID and returns the full public `AgentSession` shape newest first. A global caller must therefore discover Tasks first and issue per-Task session and workspace calls. The current implementation branch also contains an unshipped `tasks.listUsageCandidates()` contract designed around one plugin's attribution algorithm. The next Plugin SDK package has not been published, so that contract can be replaced without a public compatibility period.

The plugin host exposes common APIs through SDK types, frontend and backend adapters, Electron IPC registration, Rust callbacks, SQLite queries, generated runtime assets, and CommonAPIFake. The new operation must agree at each boundary and must remain compact enough for thousands of sessions.

## Goals / Non-Goals

**Goals:**

- Make Agent Sessions a first-class paginated public resource instead of deriving a global session set from full Tasks.
- Give callers enough Task and workspace context to attribute or locate provider-owned history without follow-up calls.
- Bound each request and support durable continuation against caller-selected time boundaries.
- Preserve the existing task-scoped session API and its return ordering.
- Publish one SDK version whose source types, generated declarations, test fake, and packaged host runtime all expose the same contract.

**Non-Goals:**

- Store, parse, aggregate, or interpret Codex usage in the OpenForge host.
- Offer arbitrary Task projections or a general database query language through `tasks.list()`.
- Search transcript directories or infer provider identities when an Agent Session lacks one.
- Guarantee a database snapshot across page requests while existing session rows are concurrently corrected or resumed.
- Change the existing `tasks.listSessions()` contract.

## Decisions

### Add a first-class Agent Sessions API

Add `agentSessions: AgentSessionsAPI` to the common OpenForge API and expose:

```ts
interface AgentSessionsAPI {
  list(request: ListAgentSessionsRequest): Promise<AgentSessionSummaryPage>
}
```

Keep `tasks.listSessions()` as the task-scoped convenience API. Do not make its Task ID optional or conditionally change its array response into a page. A separate resource keeps return types predictable and gives future session-oriented capabilities a coherent home.

Alternative considered: extend `tasks.list()` with field selection and relation expansion. That would make payload size depend on runtime options, complicate TypeScript return types, and turn a simple Task API into a query language.

Alternative considered: add `tasks.listSessionSummaries()`. It avoids a breaking overload but still implies that every query is rooted in one Task even when the intended operation spans Tasks.

### Use a required provider and closed-open activity interval

The request shape is:

```ts
interface ListAgentSessionsRequest {
  provider: string
  overlaps: {
    startInclusive: number
    endExclusive: number
  }
  taskId?: string
  cursor?: string
  pageSize: number
}
```

The provider remains an open string to match the existing provider model. Requiring it bounds the query and makes `providerSessionId` meaningful. The optional Task ID supports targeted history without a separate method. A Task may have many sessions, so targeted results remain paginated.

For terminal sessions, the stored interval is `[createdAt, updatedAt]`. For non-terminal sessions, the end is treated as open. A session is eligible only if it starts before `endExclusive` and its effective end is at or after `startInclusive`. This admits a session active across the start boundary while excluding sessions that start at the exclusive end.

Alternative considered: accept only `periodStart`. That allows sessions created after an import's immutable live boundary to enter later pages and makes a resumed historical generation less predictable.

### Return one compact row per Agent Session

Each page item uses a fixed shape:

```ts
interface AgentSessionSummary {
  id: string
  provider: string
  providerSessionId: string | null
  createdAt: number
  updatedAt: number
  task: {
    id: string
    title: string
    status: TaskStatus
    createdAt: number
    updatedAt: number
  }
  workspace: {
    rootPath: string
    kind: 'project' | 'worktree'
  } | null
}
```

`id` is the OpenForge Agent Session ID. `providerSessionId` explicitly distinguishes the provider-owned identity from that ID. Returning null preserves an observable omission that import and diagnostic callers can count; the host does not search a workspace to manufacture an identity.

Task metadata is nested to avoid ambiguous timestamps and to leave the top level session-oriented. The Task title falls back to its ID when no display title exists. Workspace resolution uses the current Task workspace first and the legacy worktree as fallback, matching existing host behavior. Shared project workspaces may appear on rows from several Tasks.

The query must project only these columns. It must not deserialize full Task or Agent Session rows and then remove sensitive fields.

Alternative considered: return one Task with a nested session array. That reduces repeated Task fields but makes pagination Task-centric, admits Tasks without sessions, and recreates the usage-candidate contract under a broader name.

### Use deterministic keyset pagination with filter-bound cursors

Order rows by `createdAt ASC, id ASC`. Fetch `pageSize + 1` rows to determine whether another page exists. The opaque cursor carries a version, the last ordering tuple, and a fingerprint of provider, interval, and optional Task ID. Reject malformed cursors and cursors used with different filters.

The cursor provides deterministic keyset continuation but does not hold a database transaction open across requests. The immutable `endExclusive` prevents newly created post-boundary sessions from joining a historical import. Late corrections or resumptions of existing records can still change eligibility; callers that need repair use a new explicit recovery generation rather than treating one cursor as a permanent database snapshot.

Alternative considered: expose the last Agent Session ID directly. That couples plugins to ordering details and cannot detect accidental cursor reuse with different filters.

### Query Task and workspace context in one database operation

Implement one bounded SQLite query that filters Agent Sessions first, joins the owning Task, and resolves Task workspace or legacy worktree context. Use a dedicated index selected from query-plan evidence. Avoid per-session Task and workspace lookups.

Provider-specific IDs are normalized in the query boundary from the existing provider columns. Unknown providers remain queryable but return null provider session IDs unless the host stores a supported identity for them.

Active-session overlap must use the host's centralized terminal-status definition rather than a second drifting list of status strings. Database tests cover terminal, paused, interrupted, and running states at exact boundaries.

### Replace the unshipped candidate API instead of supporting both

Remove the unshipped `tasks.listUsageCandidates()` SDK types, fake state, callbacks, IPC route, database module, docs, and tests from the implementation branch. Reuse useful query and index work only where it serves the Agent Session contract. Shipping both would create two overlapping public paths and leave a use-case-specific API to maintain.

If integration discovers that the candidate API reached a released mainline despite the current assumption, stop and treat removal as a compatibility decision rather than silently deleting it.

### Keep CommonAPIFake and packaged runtime contract-equivalent

CommonAPIFake accepts seeded compact Tasks, Agent Sessions, and workspace data, records list requests, validates requests and cursors, and applies the same overlap, ordering, and pagination rules. Contract fixtures import the new public types and call the API.

Generate Plugin SDK declarations and the plugin-host runtime from source. Tests must exercise the generated or packed artifacts so source-only availability cannot pass release checks.

## Risks / Trade-offs

- [Session-only discovery omits Tasks whose Agent Session row is missing] -> Return null only for a missing provider identity on an existing session, never scan shared workspaces, and let consumers report omissions or request data repair.
- [Task and workspace fields repeat for Tasks with many sessions] -> Keep both nested records compact; bounded pages make the repeated payload predictable.
- [Concurrent lifecycle updates can change eligibility between pages] -> Use immutable caller boundaries, deterministic keyset ordering, filter-bound cursors, and explicit recovery generations for late corrections.
- [Terminal-status rules drift between lifecycle and query code] -> Reuse one host-owned status predicate and cover every current status in database tests.
- [A source-only SDK change is absent from packaged plugins] -> Build and inspect the packed tarball and generated plugin-host runtime, then execute a backend host-routing contract test against the packaged API.
- [A provider has no dedicated identity column] -> Return null rather than guessing; adding a provider identity mapping remains an explicit host change.

## Migration Plan

1. Confirm that `tasks.listUsageCandidates()` has not shipped in an npm release or merged mainline. Replace it in the current implementation branch rather than creating a deprecation period.
2. Add the SDK Agent Sessions contract and CommonAPIFake behavior while retaining `tasks.listSessions()` compatibility tests.
3. Replace the candidate database and host callback path with the paginated Agent Session query and exact-boundary tests.
4. Regenerate IPC registrations, TypeScript declarations, SDK assets, and plugin-host runtime bundles.
5. Run focused tests followed by full Plugin SDK, renderer, IPC, Rust database/host, package-contract, and packaged-runtime validation.
6. Publish the next unused Plugin SDK version and verify its npm metadata and packed declarations before consumers upgrade.
7. Let `com.openforge.codex-usage` adopt the API in a separate change for explicit historical import. Do not add an unscoped Task-list fallback.

Rollback before publication removes the new API and restores the prior published SDK contract. After publication, leave the additive Agent Sessions API available even if the first consumer rolls back; revert only host or consumer activation changes that are faulty.