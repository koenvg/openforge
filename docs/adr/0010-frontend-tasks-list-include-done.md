# Frontend tasks.list gains opt-in includeDone

Status: Accepted
Task: KVG-1713

The plugin `tasks.list` capability was asymmetric across the two host runtimes. The frontend path (`pluginHostCommands.listTasks` -> `getTasksForProject` -> the `get_tasks_for_project` app-invoke command) deliberately dropped `done` tasks by calling `get_tasks_for_project_excluding_state(project_id, "done")`, because the app board consumes that same result as its active-only `activeTasks` view. The backend path (`plugin_host::task_callbacks`) instead called `get_tasks_for_project` with no exclusion, so a plugin listing tasks saw different results depending on which runtime it ran in. This blocked the Jira plugin (`dev.kvg.jira`), which is already written to render OpenForge Tasks linked to a Jira Issue in any status but could never surface done Tasks through the frontend capability.

OpenForge will extend the shared `tasks.list` capability with an optional `includeDone` flag: `list(request?: { projectId?: string | null; includeDone?: boolean })`. The flag defaults to `false`, threads through the existing host wiring (`runtimeContributionRegistry` -> `pluginHostCommands` -> `ipc.getTasksForProject` -> the `get_tasks_for_project` app-invoke command), and when `true` the command calls `get_tasks_for_project` (all states) instead of the excluding-state variant. The unscoped listing (no `projectId`) already returns all states via `get_tasks`, so `includeDone` only affects the project-scoped path.

## Considered options

- **Extend the shared host capability (chosen).** One contract serves both the app board and plugins; the default preserves existing behaviour, and plugins that need done Tasks opt in explicitly. It keeps a single source of truth for task listing and removes the frontend/backend asymmetry from the caller's point of view.
- **Route the plugin's work through the backend runtime.** Rejected: it would force a plugin to split its logic across runtimes purely to escape a frontend-only filter, and the backend path's "all states" behaviour is itself undocumented and incidental rather than a deliberate contract.
- **Accept the limitation.** Rejected: it permanently prevents the Jira plugin (and any future plugin) from presenting done Tasks through the frontend capability, and leaves the two runtimes silently disagreeing.

## Consequences

- The app board is unchanged: `appDataOrchestrator` still calls `getTasksForProject(projectId)` with no flag, so its `activeTasks` view stays active-only. `includeDone` defaults to `false` at every layer (SDK type, host bridge, IPC wrapper, and the Rust command's absent-or-false handling).
- The `get_tasks_for_project` app-invoke command now accepts an optional `includeDone` boolean payload key; the migration contract records it. The HTTP `/tasks` REST handler already supported `include_done`/`exclude_done` and is not the plugin-reachable path (plugins go through `/app/invoke`), so it is unchanged.
- The plugin-sdk testing mock honours `includeDone` against seeded tasks so plugin authors can assert both the active-only default and the include-done opt-in.
- Plugin-side consumption (passing `includeDone: true`, active-first-then-done ordering) is out of scope here and tracked on KVG-1710, which depends on this task.
