## Context

See `proposal.md` for motivation and `specs/plugin-view-replacements/spec.md` for behavior. Today, plugin Views are additive routes placed in the icon rail or project sidebar. The app treats `board` as both the project dashboard destination and the route that hosts selected task detail. Several navigation paths depend on that stable identity, including task opening, project restoration, history, settings closure, and the dashboard shortcut.

Frontend plugins already register runtime contributions and render through host error boundaries. They receive typed task, project, navigation, storage, and system APIs. They do not have a typed task invalidation subscription. Project-enabled plugins also contribute only while active for the current project, so a persisted provider can be temporarily absent.

Task rendering has a harder constraint than dashboard rendering. `terminalPool.ts`, agent sessions, and browser controllers own resources that must survive or stop according to logical task identity. Replacing visible content cannot transfer those lifecycles to an arbitrary component.

## Goals / Non-Goals

**Goals:**

- Establish one typed registration and resolution mechanism that can support more replaceable host views later.
- Ship project dashboard and task detail as the first two targets.
- Preserve host routes and resource ownership while allowing plugins to replace the visible content.
- Make provider choice explicit, persistent, project-aware, and recoverable.
- Give replacement components target-specific props and a typed task invalidation API.

**Non-Goals:**

- Replacing the app shell, global settings, plugin management, or recovery controls in this change.
- Turning the core Focus Board or task workspace into plugins.
- Treating existing rail or sidebar Views as replacement candidates.
- Giving plugins direct access to renderer stores, `terminalPool.ts`, or private components.
- Adding plugin presets that select several replacements together.
- Guaranteeing that a replacement reproduces every control in the core renderer.

## Decisions

### Add a separate view-replacement registry

Add `openforge.viewReplacements.register(...)` to the frontend plugin API. The registration is a discriminated union keyed by `target`:

```ts
type ReplaceableViewTarget = 'project.dashboard' | 'task.detail'

type PluginViewReplacementRegistration =
  | PluginProjectDashboardReplacementRegistration
  | PluginTaskDetailReplacementRegistration
```

Every registration includes a plugin-local `id`, `target`, `title`, optional icon where navigation metadata applies, and a component or component loader. The host derives a qualified provider ID from plugin ID plus contribution ID. A plugin must declare a new `viewReplacements` package capability before registration.

Runtime snapshots, testing fakes, public entrypoint checks, contribution resolution, and component registration gain a replacement collection. Contribution claims use a separate `viewReplacements` namespace, so a View and replacement may use the same local ID without becoming the same contribution.

Alternatives considered:

- Extend `views.register` with `placement: 'dashboard'`. This couples additive destinations to replacement providers and does not generalize cleanly to task detail.
- Let users select any plugin View. Most Views do not claim compatibility with a host contract, and app-enabled or sidebar Views may be cross-project.
- Let plugins imperatively replace a view. That would allow installation or activation to take over the app without user consent.

### Keep host route identity stable

The host continues to use `board` as the internal project-home and selected-task route. Presentation resolution happens after navigation state decides whether a task is selected:

```text
currentView = board
        |
selected task?
   |         |
  yes        no
   |         |
task.detail  project.dashboard
   |         |
provider resolver
   |
core component or plugin component
```

Dashboard navigation keeps its stable position and shortcut. When a plugin dashboard is effective, the host uses its title and icon in that navigation entry. When the core dashboard is effective, existing Focus Board attention badges and repeat-invocation behavior remain unchanged. Re-invoking a plugin dashboard emits the normal host invocation without mutating the hidden Focus filter.

Task navigation continues to set selected-task state and history before renderer resolution. A dashboard plugin opens tasks through the public navigation API or its host callback, never by changing a replacement provider route.

Alternative considered: navigate directly to the selected plugin's View key. This breaks task detail rendering, per-project restoration, settings return, and history semantics when the provider disappears.

### Resolve preferences without rewriting unavailable choices

Persist provider maps under dedicated global and project config keys. Each target stores one of:

- `core`
- a qualified replacement provider ID
- `inherit`, for project overrides only

Resolution follows this order:

1. Read the project override.
2. If it is `inherit` or absent, read the global default.
3. If the chosen plugin contribution is active and matches the target, use it.
4. Otherwise render `core` while retaining the configured value and reporting it as unavailable.

The global settings page exposes a default selector for each target. Project settings exposes `Inherit`, `OpenForge`, and compatible active providers. If a stored provider is absent, the selector includes an unavailable entry rather than dropping the value.

The settings model and resolver operate on qualified IDs rather than package display names so plugin renames and duplicate contribution titles do not create ambiguity.

Alternative considered: clear the preference when a plugin disappears. That loses user intent during ordinary project disablement, activation failure, reload, or reinstall.

### Use target-specific props

The SDK maps each target to a concrete props contract instead of passing an untyped bag.

The project dashboard contract includes the frontend API, plugin context, active `Project`, and callbacks for opening a task, opening the host task composer, and opening command search.

The task detail contract includes the frontend API, plugin context, `TaskDetail`, related task references, project identity, and callbacks for opening another task, opening the host edit flow, opening host task actions, and refreshing bounded task data.

Host callbacks follow the project's `on`-prefixed callback convention. Components receive new props or remount when the logical project, task, plugin, or provider changes. Wrapper teardown keys use logical identity rather than relying on effect cleanup tied to individual prop evaluations.

Plugins remain free to use public SDK components and APIs. They do not receive terminal objects, browser controller internals, or Svelte stores. If later work exposes more composable task resources, those resources must keep host-managed acquisition and disposal.

Alternative considered: pass only IDs and require every renderer to fetch everything. That causes avoidable loading flashes, duplicates already-bounded task reads, and makes host edit and action flows inaccessible.

### Isolate replacement failures at the host-view boundary

A host-owned wrapper resolves and loads the effective provider. Plugin rendering runs inside a boundary whose failure branch renders the core component with the same logical context. Loader and render failures go through existing plugin diagnostics.

Fallback is local to the target. A broken task replacement does not disable the plugin's dashboard, commands, or other contributions. Deactivation and uninstall remove registered components and subscriptions before the host recomputes the effective provider.

The wrapper does not persist a switch to `core` after failure. A later plugin reload or contribution refresh may recover without losing the user's selection.

### Add typed task invalidation instead of exposing stores

Extend `TasksAPI` with a disposable project-filtered subscription. Events are invalidations, not task snapshots:

```ts
interface TaskChangeEvent {
  projectId: string
  taskId: string | null
  reason: 'created' | 'updated' | 'completed' | 'attention' | 'execution'
}

onDidChange(
  projectId: string,
  handler: (event: TaskChangeEvent) => void,
): Disposable
```

The renderer plugin host bridges host-observed task changes into per-plugin subscriptions. Delivery occurs after the host accepts or observes the change, so subscribers can repeat `tasks.active`, `tasks.completed`, or `tasks.detail`. Event coalescing is allowed because the contract is invalidation-based.

Subscription ownership is attached to plugin lifecycle cleanup. Project filtering happens before invoking plugin handlers. Tests must cover explicit disposal, deactivation, uninstall, and cross-project filtering.

Alternative considered: document raw desktop event names through `events.onGlobal`. Those names are untyped, expose transport details, and make SDK compatibility depend on internal IPC naming.

### Keep future targets explicit

The target union is closed for the current API version. Adding sidebar, attention overview, settings, composer, review, or shell replacement requires a typed props contract, core fallback, selection UI, and lifecycle tests for that target. Plugins cannot register arbitrary target strings and wait for a future host to interpret them.

This makes future expansion deliberate. It also prevents a plugin from claiming recovery-critical UI before OpenForge has a safe escape path.

## Risks / Trade-offs

- [A selected provider is unavailable during project activation] -> Resolve contributions reactively, render core immediately, retain the preference, and switch only after the expected provider becomes active.
- [A plugin task renderer leaks task-owned resources] -> Keep terminal, agent, and browser ownership in host services; remount by logical identity; validate teardown with lifecycle tests.
- [Fallback hides recurring plugin failures] -> Record loader and render failures in plugin diagnostics and mark the configured provider unavailable in settings.
- [Task invalidations arrive in bursts] -> Define events as coalescible invalidations and require bounded reads after notification.
- [Global defaults point to project-enabled plugins unavailable in some projects] -> Fall back per project without changing the global setting and show effective availability in project settings.
- [The public API grows around current core callbacks] -> Keep callbacks limited to stable host workflows and expose new task capabilities through domain APIs where possible.
- [Dashboard title changes make help text inconsistent] -> Describe the shortcut as opening the project dashboard while retaining the selected provider's navigation title and icon.

## Migration Plan

1. Add the SDK capability, registration types, testing contract, and runtime contribution support without exposing any host target.
2. Add persisted provider resolution with all defaults set to `core`. Existing installations require no config migration.
3. Put the dashboard and task detail core components behind host-owned provider wrappers while behavior remains core-only.
4. Enable plugin provider selection and settings after fallback and lifecycle coverage passes.
5. Add task invalidation subscriptions and document authoring examples.

Rollback removes the selectors and ignores replacement contributions. Stored provider keys can remain because older builds do not read them. Core routes and components remain intact throughout, so rollback does not require data conversion.
