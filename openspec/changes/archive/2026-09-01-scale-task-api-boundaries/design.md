## Context

See `proposal.md` for the scaling problem. The current working implementation introduced the right persistence foundations but exposed overlapping old and new reads, caller revision tokens, transport-specific detail results, optional scopes, configurable page limits, and two renderer Task models. That breadth moved cache, race, compatibility, and projection policy into callers.

Production exploration found more than 3,500 Completed Tasks but fewer than 70 non-Completed Tasks across projects. Completed full rows occupied roughly 48.7 MB, while the active full set occupied about 92 KB. The design must optimize these populations differently without making each caller choose a projection or payload strategy.

The change has not shipped, so first-party implementation can break. Published version 1 reads remain temporarily available because external plugins and scripts may already depend on their documented behavior.

## Goals / Non-Goals

**Goals:**

- Present three obvious Task read intents with explicit payload guarantees.
- Keep Focus selection synchronous after one bounded project read.
- Bound every canonical list and relationship result by contract.
- Give desktop IPC, HTTP, CLI, plugin hosts, the SDK, and in-memory tests the same semantics.
- Concentrate Task read policy in a deep Rust module and renderer state policy in a deep TypeScript module.
- Isolate compatibility so it cannot shape first-party code.
- Replace the rejected implementation rather than adding another path beside it.

**Non-Goals:**

- Preserve source compatibility for unshipped first-party methods.
- Make the legacy broad `list()` scalable without changing its behavior.
- Add caller-selected projections, arbitrary query plans, or all-project active reads.
- Add pagination to Focus or immediate relationship rendering.
- Merge Task Attention, Implementation Run, or Agent Session models into Task projections.
- Add a fourth Task projection for inspector UI.

## Decisions

### Use three canonical projections

The canonical projections remain `TaskReference`, `TaskSummary`, and `TaskDetail`.

- `TaskReference` contains compact identity, project, state, resolved Task Display Title, and dependency direction needed for relationship rendering.
- `TaskSummary` adds bounded list fields such as timestamps, `promptPreview`, assigned Task Labels, and source ticket URL.
- `TaskDetail` adds the canonical authoring prompt and full single-Task fields needed by Focus and Task detail.

Every new request and projection uses camelCase. Rust maps its internal names at serialization. The plugin SDK, HTTP JSON, CLI JSON, desktop IPC, generated runtime, and in-memory adapter use the same field names.

`TaskDetail.prompt` maps to the user-authored prompt. Start-time contributions and execution overrides remain internal to Implementation Run creation. Prompt previews strip valid image-reference definitions and keep at most 120 Unicode characters. Resolved fallback Task Display Titles use the same bounded preview rule, while explicit Task Display Titles remain lossless.

Alternative considered: one full Task type everywhere. It recreates unbounded Completed Task payloads. Another alternative exposed caller-selected projections. That would shrink the method count while making the behavioral interface larger and easier to misuse.

### Expose three read intents

The canonical interface is:

```ts
interface Tasks {
  active(projectId: ProjectId): Promise<ActiveTasks>
  completed(projectId: ProjectId, query?: CompletedTaskQuery): Promise<CompletedTaskPage>
  detail(projectId: ProjectId, taskId: TaskId): Promise<TaskRead | null>
}

interface ActiveTasks {
  tasks: TaskDetail[]
  related: TaskReference[]
}

interface CompletedTaskPage {
  tasks: TaskSummary[]
  nextCursor: string | null
}

interface TaskRead {
  task: TaskDetail
  related: TaskReference[]
}
```

`active` always means every non-Completed Task in one project. `completed` always means a bounded page of Completed Tasks in one project. `detail` always means one complete Task plus immediate relationship context. Callers do not select status, scope, projection, page size, or relationship expansion.

Task Label filters remain names because CLI users and plugin callers already work with project-scoped label names. The completed query accepts optional `search`, `labels`, and `cursor` fields. The cursor is opaque and bound to the project and normalized filters.

Alternative considered: one discriminated `read()` method. It has one method name but still exposes three request and result variants, forcing callers and adapters to dispatch unions. Three intent names have greater depth because each name fixes result shape and payload cost.

### Bound active Tasks and direct relationships at write time

A project may contain at most 500 non-Completed Tasks. Task creation, restoration, or state transition checks the count in the same transaction as the write.

A Task may participate in at most 100 direct relationships total. Adding a dependency checks the direct dependency and dependent counts of both participating Tasks in the same transaction. Re-adding an existing edge remains idempotent and does not consume capacity.

These limits make eager project details and complete immediate relationship rendering bounded without pagination controls. They are well above observed active usage and ordinary dependency counts.

Alternative considered: paginate active Tasks or relationships. Active pagination would break synchronous selection for unloaded Focus cards. Relationship pagination would spread continuation state into every full Task view. Another alternative left both reads technically unbounded based on current production size; that would repeat the original problem with a smaller data population.

### Fix Completed Task pages at 50 items

`completed` uses `updatedAt DESC, id DESC` keyset ordering and always returns at most 50 summaries. Callers cannot request a different page size or status. The cursor contains a format version, normalized request scope, and the last ordering values. A cursor from another project or filter set fails with a typed cursor error.

The query validates raw input before normalization:

- search has at most 200 Unicode characters
- callers submit at most 20 Task Label names
- each trimmed Task Label name has at most 40 Unicode characters
- ASCII search is case-insensitive
- non-ASCII casing remains exact

The SQL reads persisted `prompt_preview` rather than full prompt columns. It fetches 51 rows to decide whether a next cursor exists, then hydrates Task Labels and dependencies in a fixed number of statements.

Alternative considered: retain a 1 through 200 limit. Callers do not need that control, and it weakens the payload guarantee. Offset pagination remains rejected because deep offsets slow down and concurrent changes shift rows.

### Deepen the Rust Tasks module

One Rust Tasks module owns:

- coherent active result assembly in one database read transaction
- projection assembly and resolved Task Display Titles
- Completed Task request validation and cursor policy
- detail relationship assembly
- project, Task, cursor, validation, and limit outcomes
- active and relationship limit enforcement used by write paths

Persistence query helpers remain internal implementation. Desktop IPC, HTTP, CLI, and plugin callbacks become adapters that translate transport input and output only. They do not choose scopes, projections, defaults, missing-Task behavior, or error categories.

The Rust production adapter and TypeScript in-memory adapter run the same black-box contract cases where practical. Tests treat cursor contents as opaque. Transport tests verify encoding, routing, and error mapping without repeating Task policy.

Alternative considered: retain the current thin `task_read_service.rs` pass-through. Deleting it would move little implementation because callers still understand database acquisition, snapshot composition, and errors. The replacement must have enough depth that deleting it would scatter policy back across every adapter.

### Give renderer Task read state one owner

One renderer Tasks state module owns:

- cached active results by project
- synchronous selection from the active Task map
- a true 20-entry LRU for on-demand details
- active and on-demand relationship context
- deletion and project-removal eviction
- same-project refresh retention
- uncached cross-project detachment
- request generations and stale-result rejection
- derived selected Task and visible relationships

The module stores canonical `TaskDetail` records only. It does not maintain a parallel legacy `Task[]` view or expose mutation functions that require callers to coordinate cache order. The orchestrator requests project refreshes. Navigation requests selection. Agent Session event handlers request invalidation or refresh. None implements cache or generation policy.

Concurrency generations remain private to the module. `active` has no caller revision parameter. A commit checks request generation, Selected Project, Task identity, and returned project before changing visible state.

Task-scoped plugin UI receives the selected cached `TaskDetail`. Task Attention remains a separate lane projection and derives navigation references from its own rows. The command palette uses active data and active Task IDs rather than broad reads.

Alternative considered: retain independent snapshot, navigation, and event generations. That duplicates the hardest policy and forces tests to mock several stores. One owner improves locality and makes its interface the test seam.

### Return relationship context from detail everywhere

Every canonical `detail` adapter returns `TaskRead`, not a bare `TaskDetail`. This removes the renderer-only `get_task_read_context` path and prevents frontend, backend, HTTP, CLI, and desktop callers from seeing different semantics.

The `related` collection contains immediate `TaskReference` records needed to resolve direct dependencies and dependents not already represented by the detail record. The 100-relationship write limit bounds the result.

Alternative considered: keep public detail bare and add a desktop-only envelope. That caused adapter drift and made relationship completeness depend on which transport a caller used.

### Isolate deprecated compatibility

Published version 1 `list()` and `get()` remain at outer compatibility seams only.

- The compatibility adapter calls canonical persistence or Tasks module operations and converts results to the legacy projection.
- It preserves documented scope, `includeDone`, prompt, missing-Task, and complete-array behavior exactly.
- It does not silently cap the legacy list, so that call remains intentionally non-scalable.
- Plugin hosts emit at most one `list()` deprecation warning per plugin activation.
- Legacy HTTP and CLI commands remain documented as deprecated.
- First-party desktop code and bundled plugins cannot import or call compatibility adapters.
- Version 2 omits `list()` and `get()`.

Compatibility tests cover only observable legacy behavior and conversion. No canonical policy is implemented in the adapter.

Alternative considered: silently page or cap legacy `list()`. That would be a breaking semantic change disguised as compatibility. Another alternative removed published version 1 immediately, which would strand existing external callers without a migration period.

### Replace the current implementation before rebuilding

Implementation follows a replace-first sequence:

1. Rewrite contract tests for `active`, `completed`, and `detail`.
2. Remove rejected method names, caller revisions, transport-specific detail shapes, optional scopes, limit and status controls, dual renderer state, and generated artifacts tied to them.
3. Run focused tests and confirm failures describe the missing canonical modules rather than stale expectations.
4. Build the deep Rust Tasks module and enforce write-time bounds.
5. Build the renderer Tasks state module.
6. Add translation-only production adapters and the in-memory adapter.
7. Add isolated deprecated compatibility adapters.
8. Regenerate runtime artifacts and run the full affected-system checks.

The replacement keeps the persisted preview migration, projection foundations, keyset SQL structure, narrow internal queries, and production-scale fixtures where they still match the revised contract.

## Risks / Trade-offs

- [Legacy `list()` remains unbounded] → Keep it isolated, warn once, remove first-party usage, document canonical migration, and remove it in version 2.
- [A project reaches 500 non-Completed Tasks] → Reject the write atomically and direct the user to complete or delete Tasks before creating or restoring another.
- [A Task reaches 100 direct relationships] → Reject the new edge atomically and keep existing relationship state unchanged.
- [Replacing a passing implementation creates a large temporary test failure set] → Rewrite focused contract tests first, remove one rejected slice at a time, and keep full validation until canonical adapters are connected.
- [Cross-language adapter behavior drifts] → Run shared contract fixtures against Rust production behavior and the in-memory adapter; keep transport tests limited to translation.
- [Fixed pages require more calls for bulk tools] → Preserve opaque cursors and predictable 50-item payloads; bulk callers can continue until `nextCursor` is null.
- [Explicit Task Display Titles remain larger than previews] → Keep authored titles lossless as a deliberate product contract while bounding list count, prompt preview, active count, and relationship count.

## Migration Plan

1. Update public documentation with the three canonical reads and version 1 deprecation schedule.
2. Replace current unshipped reads and first-party state as described above.
3. Ship canonical methods across desktop IPC, versioned HTTP, CLI, frontend plugins, backend plugins, and the SDK together.
4. Keep version 1 compatibility adapters available and instrument plugin `list()` usage through once-per-activation warnings.
5. Verify no first-party source imports or calls legacy Task reads.
6. In version 2, remove compatibility declarations, routes, commands, conversion code, warnings, and tests.

Rollback before release restores the current working implementation from version control. Rollback after release keeps persisted `prompt_preview` and indexes because legacy reads tolerate those additive database fields; canonical routes and methods can be disabled without destructive data conversion.
