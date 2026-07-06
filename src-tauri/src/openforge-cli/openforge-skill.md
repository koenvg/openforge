---
name: openforge
description: Manage OpenForge tasks from AI providers using the installed OpenForge CLI client.
---

# OpenForge task management

Use this skill when you need to create follow-up work, inspect task context, or update the current task summary in OpenForge.

Task prompt semantics are intentionally narrow: `openforge task update` only updates the task `summary` field (Handoff Notes). It does not update `initial_prompt` or `prompt`, and must not be presented as a way to change task prompt text.

Use the installed `openforge` launcher directly. If `openforge` is not available on PATH in a non-interactive shell, call the launcher with its explicit fallback path:

```bash
openforge project list
"$HOME/.openforge/bin/openforge" project list
```

Do not bypass the launcher with the underlying script path.

If OpenForge is listening on a non-default HTTP bridge port, set `OPENFORGE_HTTP_PORT` before running the command. The default is `17422`.

Use canonical nested command groups (`openforge task create`, `openforge task update`, `openforge task list`, `openforge task plan apply`, `openforge project list`, `openforge project labels list`). Flat task/project compatibility aliases are no longer supported.

Plugin management commands are local-only for agent-facing use: install from a local source path with `openforge plugin install --path <local-plugin-source>`, separately enable or disable an installed plugin for a project with `openforge plugin enable|disable --plugin-id <id> --project-id <id>`, and explicitly reload installed artifacts with `openforge plugin reload --plugin-id <id> [--project-id <id>]`. Do not pass npm, git, source-spec, watch, or rebuild inputs to these commands.

## Task Creation checklist

Before creating follow-up Tasks, run the project label discovery command when you know the project id. Reuse an existing project label when it fits; only create a new label through `--label` when the category is genuinely new and useful. When dependency order is known, add useful --label values and dependency links during Task Creation with `--label` and `--depends-on`; do not invent noisy labels or guessed ordering just because labels and dependencies exist.

When creating multiple related Tasks, decide whether any Task must be done before another can start. For non-linear multi-Task follow-up work, use `openforge task plan apply --file <plan.json>` as the preferred workflow for non-linear multi-Task follow-up work so local dependency keys, labels, prompts, and generated task IDs are resolved in one operation. Use `dependsOn` for current or prerequisite task IDs and local keys. For simple linear follow-ups, link prerequisites immediately with `--depends-on` during creation when the predecessor ID is known, or use `openforge task dependencies link --chain "T-1 -> T-2 -> T-3"` after all Task IDs exist.

If labels or dependency order are unclear, mention that uncertainty in Handoff Notes or open questions instead of guessing.

## Common commands

```bash
openforge task plan apply --file follow-up-plan.json
openforge task create --initial-prompt "Describe the follow-up work" --worktree "$PWD" --depends-on T-122 --label cleanup
openforge task update --task-id T-123 --summary "What changed and what needs attention"
openforge task get --task-id T-123
openforge project labels list --project-id P-1
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

Rare prompt-repair workflow: if a task was created with the wrong initial prompt, do not try to repair it with `task update`. Use the CLI help for the full safe replacement workflow:

```bash
openforge task create --help
openforge task update --help
```

## Guidance

- Create follow-up tasks for real cleanup or missing work; do not create tasks for trivial preferences.
- Update the active task with concise Handoff Notes before finishing; this writes the task summary only.
- Use `task delete` only when the user explicitly wants an OpenForge task removed; it returns JSON status output from the backend deletion bridge.
- Use dependencies to record prerequisite ordering, not to mark tasks blocked; Start Task enforcement is intentionally left to the app UX.
- Use labels to record task categories or triage context when useful. Run `project labels list` before creating follow-up tasks when a project id is available; reuse useful existing labels and avoid noisy one-off labels.
- Task summaries are Markdown-formatted; use short paragraphs or bullets when they improve readability.
- The CLI prints JSON so you can pass results back into your reasoning without scraping UI text.
