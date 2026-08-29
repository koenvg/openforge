---
name: openforge
description: Manage OpenForge tasks from AI providers using the installed OpenForge CLI client.
---

# OpenForge task management

Use this skill when you need to create follow-up work, inspect task context, or correct a task prompt before execution starts.

`openforge task update --initial-prompt` atomically replaces both `initial_prompt` and the effective `prompt`, but only while the task has never started. Started or completed tasks require a replacement task.

Use the installed `openforge` launcher directly. If `openforge` is not available on PATH in a non-interactive shell, call the launcher with its explicit fallback path:

```bash
openforge project list
"$HOME/.openforge/bin/openforge" project list
```

Do not bypass the launcher with the underlying script path.

If OpenForge is listening on a non-default HTTP bridge port, set `OPENFORGE_HTTP_PORT` before running the command. The default is `17422`.

Use canonical nested command groups (`openforge task create`, `openforge task update`, `openforge task start`, `openforge task list`, `openforge task plan apply`, `openforge project list`, `openforge project labels list`, `openforge debug process-memory`, `openforge debug process-memory-history`). Flat task/project compatibility aliases are no longer supported.

`openforge task start --task-id <id>` starts the native configured implementation flow using persisted task and project configuration. Dependency, concurrent-start, active-session, workspace, provider, and PTY safeguards remain authoritative; the command does not accept runtime overrides.

Plugin management commands are local-only for agent-facing use. Install from a local source path with `openforge plugin install --path <local-plugin-source>`. Enable or disable project-enabled packages with `openforge plugin enable|disable --plugin-id <id> --project-id <id>`. Enable or disable app-enabled packages with `openforge plugin app enable|disable --plugin-id <id>`. Reload installed artifacts with `openforge plugin reload --plugin-id <id> [--project-id <id>]`. Installation never enables a plugin. Pass no npm, git, source-spec, watch, or rebuild inputs to these commands.

## Agent-facing Plugin Commands

Use the generic Plugin Command workflow for capabilities contributed by enabled Trusted Plugins:

1. Discover routine commands with `openforge plugin command list`. Pass `--task-id <id>` or `--project-id <id>`; inside an Implementation Run, Task context defaults from `OPENFORGE_TASK_ID` when neither flag is supplied.
2. Inspect the exact command before using it with `openforge plugin command describe --command-id <qualified-id>`. The JSON descriptor contains plugin-owned input/output schemas, examples, runtime, and guidance. Commands hidden from routine listing can still be described and invoked only by their exact qualified identifier when explicitly agent-enabled.
3. Invoke with `openforge plugin command invoke --command-id <qualified-id> [--input '<json>']`. Use `--task-id` or `--project-id` under the same context rules as discovery. Omit `--input` when the command takes no input.
4. Read the JSON result and handle failures rather than assuming success. Invalid JSON, schema violations, unavailable or disabled plugins, unknown commands, unavailable frontend runtimes, timeouts, and plugin handler failures are actionable errors; correct the request or report the blocker. Commands described with runtime `frontend` require OpenForge's desktop app, trusted renderer, and enabled plugin frontend runtime to be active now. They are never queued or replayed after availability returns.

Task and Project targeting are host-owned invocation context, not plugin input. Never add `taskId` or `projectId` to `--input` unless the command's own input schema explicitly declares that plugin-owned field.

## Task Creation checklist

Before creating follow-up Tasks, run the project label discovery command when you know the project id. Reuse an existing project label when it fits; only create a new label through `--label` when the category is genuinely new and useful. When dependency order is known, add useful --label values and dependency links during Task Creation with `--label` and `--depends-on`; do not invent noisy labels or guessed ordering just because labels and dependencies exist.

When creating multiple related Tasks, decide whether any Task must be done before another can start. For non-linear multi-Task follow-up work, use `openforge task plan apply --file <plan.json>` as the preferred workflow for non-linear multi-Task follow-up work so local dependency keys, labels, prompts, and generated task IDs are resolved in one operation. Use `dependsOn` for current or prerequisite task IDs and local keys. For simple linear follow-ups, link prerequisites immediately with `--depends-on` during creation when the predecessor ID is known, or use `openforge task dependencies link --chain "T-1 -> T-2 -> T-3"` after all Task IDs exist. When the planning LLM creates dependent follow-up Tasks from the Task it is currently handling, include the current Task ID in those Tasks’ existing `dependsOn` native prerequisites unless the user explicitly waives the dependency.

If labels or dependency order are unclear, report that uncertainty instead of guessing.

## Common commands

```bash
openforge task plan apply --file follow-up-plan.json
openforge task create --initial-prompt "Describe the follow-up work" --worktree "$PWD" --depends-on T-122 --label cleanup
openforge task update --task-id T-124 --initial-prompt "Corrected backlog prompt"
openforge task get --task-id T-123
openforge task start --task-id T-123
openforge project labels list --project-id P-1
openforge debug process-memory
openforge debug process-memory-history
openforge task labels list --task-id T-123
openforge task labels add --task-id T-123 --label bug
openforge task labels remove --task-id T-123 --label-id 42
openforge task dependencies set --task-id T-123 --depends-on T-121,T-122
openforge task dependencies add --task-id T-123 --depends-on T-122
openforge task dependencies link --chain "T-121 -> T-122 -> T-123"
openforge task list --project-id P-1 --full
openforge task delete --task-id T-123
```

Plan JSON shape:

```json
{
  "projectId": "P-1",
  "tasks": [
    { "key": "api", "prompt": "Build API", "labels": ["backend"] },
    { "key": "ui", "prompt": "Build UI", "dependsOn": ["api", "KVG-1957"] }
  ]
}
```

Use dependsOn for current or prerequisite task IDs or for local task keys from the same plan. `projectId` is optional when the OpenForge bridge can infer the project; include it when known. Do not include `worktree` in task plan JSON.

`task list` prints compact rows by default (`id`, `prompt_preview`, `status`, `labels`, `depends_on`, `updated_at`) for broad scans and excludes done tasks by default. Pass `--full` when you need complete TaskRow objects. Pass `--state done` only when you explicitly need completed tasks. Use `--worktree "$PWD"` with `task create` when the project can be inferred from the current worktree and no project id is known.

Labels are project-scoped. Use `project labels list --project-id <id>` before creating follow-up tasks when a project id is available, and reuse an existing label when it fits. Use `--label` on `task create` for AI-created follow-up work that already has an obvious category, and pair it with `--depends-on` when the follow-up is related to a known active task or prerequisite. `--label` can be repeated or comma-separated, e.g. `--label bug --label "needs review"` or `--label bug,cleanup`. Use `task labels add`, `task labels remove`, and `task labels list` to manage labels on existing tasks.

Prompt repair workflow: use `task update --initial-prompt` only for a never-started backlog task. If OpenForge reports that execution has started, create a replacement task instead; the original task's execution history is intentionally immutable.

```bash
openforge task update --task-id T-123 --initial-prompt "Corrected prompt"
openforge task create --help
openforge task update --help
```

## Guidance

- Create follow-up tasks for real cleanup or missing work; do not create tasks for trivial preferences.
- Use `task delete` only when the user explicitly wants an OpenForge task removed; it returns JSON status output from the backend deletion bridge.
- Use dependencies to record prerequisite ordering. `task start` enforces that every dependency is done before launching the configured implementation flow.
- Use labels to record task categories or triage context when useful. Run `project labels list` before creating follow-up tasks when a project id is available; reuse useful existing labels and avoid noisy one-off labels.
- The CLI prints JSON so you can pass results back into your reasoning without scraping UI text.
