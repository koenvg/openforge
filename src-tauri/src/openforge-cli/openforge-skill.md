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

## Commands

```bash
openforge create-task --initial-prompt "Describe the follow-up work" --project-id P-1 --depends-on T-122 --label cleanup
openforge update-task --task-id T-123 --summary "What changed and what needs attention"
openforge delete-task --task-id T-123
openforge get-task --task-id T-123
openforge list-task-labels --task-id T-123
openforge set-task-dependencies --task-id T-123 --depends-on T-121,T-122
openforge add-task-dependency --task-id T-123 --depends-on T-122
openforge link-tasks --chain "T-121 -> T-122 -> T-123"
openforge get-task --task-id T-123
openforge list-task-labels --task-id T-123
openforge add-task-label --task-id T-123 --label bug
openforge remove-task-label --task-id T-123 --label-id 42
openforge list-tasks --project-id P-1 --state doing
openforge list-projects
```

Use `--worktree "$PWD"` with `create-task` when the project can be inferred from the current worktree and no project id is known.

If a task was created with the wrong initial prompt, do not try to repair it with `update-task`. Before deleting it, record the old task's labels, its own `depends_on` list, and any dependent tasks whose `depends_on` entries include the old task id. Then delete the incorrect task, create a replacement with the desired `--initial-prompt`, and repoint each dependent task to the replacement:

```bash
openforge get-task --task-id T-123
openforge list-task-labels --task-id T-123
openforge list-tasks --project-id P-1 # record tasks whose depends_on includes T-123
openforge delete-task --task-id T-123
openforge create-task --initial-prompt "Correct task prompt" --project-id P-1 --depends-on T-122 --label cleanup
openforge set-task-dependencies --task-id T-999 --depends-on T-456,T-122 # replace T-123 with new task T-456
```

When repointing dependents, pass each dependent task's full desired dependency list to `set-task-dependencies`, replacing only the old task id with the new one.

Labels are project-scoped. Use `--label` on `create-task` for AI-created follow-up work that already has an obvious category. `--label` can be repeated or comma-separated, e.g. `--label bug --label "needs review"` or `--label bug,cleanup`. Use `add-task-label`, `remove-task-label`, and `list-task-labels` to manage labels on existing tasks.

## Guidance

- Create follow-up tasks for real cleanup or missing work; do not create tasks for trivial preferences.
- Update the active task with concise Handoff Notes before finishing; this writes the task summary only.
- Use `delete-task` only when the user explicitly wants an OpenForge task removed; it returns JSON status output from the backend deletion bridge.
- Use dependencies to record prerequisite ordering, not to mark tasks blocked; Start Task enforcement is intentionally left to the app UX.
- Use labels to record task categories or triage context when they are useful for backlog filtering; do not add noisy labels just because the CLI supports them.
- Task summaries are Markdown-formatted; use short paragraphs or bullets when they improve readability.
- The CLI prints JSON so you can pass results back into your reasoning without scraping UI text.
