---
name: openforge
description: Manage OpenForge tasks from AI providers using the installed OpenForge CLI client.
---

# OpenForge task management

Use this skill when you need to create follow-up work, inspect task context, or update the current task summary in OpenForge.

Task prompt semantics are intentionally narrow: `openforge update-task` only updates the task `summary` field (Handoff Notes). It does not update `initial_prompt` or `prompt`, and must not be presented as a way to change task prompt text.

Use the installed `openforge` launcher directly. If `openforge` is not available on PATH in a non-interactive shell, call the launcher with its explicit fallback path:

```bash
openforge list-projects
"$HOME/.openforge/bin/openforge" list-projects
```

Do not bypass the launcher with the underlying script path.

If OpenForge is listening on a non-default HTTP bridge port, set `OPENFORGE_HTTP_PORT` before running the command. The default is `17422`.

## Task Creation checklist

Before creating follow-up Tasks, decide whether each one has obvious project-relevant Task Labels. Add them during Task Creation with `--label`; do not invent noisy labels just because labels exist.

When creating multiple related Tasks, decide whether any Task must be done before another can start. Link prerequisites immediately with `--depends-on` during creation when the predecessor ID is known, or use `openforge link-tasks --chain "T-1 -> T-2 -> T-3"` after all Task IDs exist.

If labels or dependency order are unclear, mention that uncertainty in Handoff Notes or open questions instead of guessing.

## Common commands

```bash
openforge create-task --initial-prompt "Describe the follow-up work" --worktree "$PWD" --depends-on T-122 --label cleanup
openforge update-task --task-id T-123 --summary "What changed and what needs attention"
openforge get-task --task-id T-123
openforge list-tasks --project-id P-1 --state doing
openforge list-task-labels --task-id T-123
openforge add-task-label --task-id T-123 --label bug
openforge remove-task-label --task-id T-123 --label-id 42
openforge set-task-dependencies --task-id T-123 --depends-on T-121,T-122
openforge add-task-dependency --task-id T-123 --depends-on T-122
openforge link-tasks --chain "T-121 -> T-122 -> T-123"
openforge list-tasks --project-id P-1 --full
openforge delete-task --task-id T-123
```

`list-tasks` prints compact rows by default (`id`, `prompt_preview`, `status`, `labels`, `depends_on`, `updated_at`) for broad scans and excludes done tasks by default. Pass `--full` when you need complete TaskRow objects. Pass `--state done` only when you explicitly need completed tasks. Use `--worktree "$PWD"` with `create-task` when the project can be inferred from the current worktree and no project id is known.

Labels are project-scoped. Use `--label` on `create-task` for AI-created follow-up work that already has an obvious category. `--label` can be repeated or comma-separated, e.g. `--label bug --label "needs review"` or `--label bug,cleanup`. Use `add-task-label`, `remove-task-label`, and `list-task-labels` to manage labels on existing tasks.

Rare prompt-repair workflow: if a task was created with the wrong initial prompt, do not try to repair it with `update-task`. Use the CLI help for the full safe replacement workflow:

```bash
openforge create-task --help
openforge update-task --help
```

## Guidance

- Create follow-up tasks for real cleanup or missing work; do not create tasks for trivial preferences.
- Update the active task with concise Handoff Notes before finishing; this writes the task summary only.
- Use `delete-task` only when the user explicitly wants an OpenForge task removed; it returns JSON status output from the backend deletion bridge.
- Use dependencies to record prerequisite ordering, not to mark tasks blocked; Start Task enforcement is intentionally left to the app UX.
- Use labels to record task categories or triage context when they are useful for backlog filtering; do not add noisy labels just because the CLI supports them.
- Task summaries are Markdown-formatted; use short paragraphs or bullets when they improve readability.
- The CLI prints JSON so you can pass results back into your reasoning without scraping UI text.
