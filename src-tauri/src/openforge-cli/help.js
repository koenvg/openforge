export function printHelp(commandSpecs) {
  console.log(`OpenForge CLI

Usage:
${commandSpecs.map((spec) => `  ${spec.usage}`).join('\n')}

Plugin Installation is local-only for now:
  Local Plugin Source: use openforge plugin install --path <local-plugin-source>
  Project Plugin Enablement is separate: use plugin enable/disable with --project-id.
  App Plugin Enablement is separate: use plugin app enable/disable without --project-id.
  Plugin Installation never enables a plugin automatically.
  Plugin reload explicitly reloads installed artifacts only; it does not watch or rebuild source.

Task prompt semantics:
  task create sets the task's initial_prompt from --initial-prompt.
  task update --initial-prompt updates initial_prompt and prompt together only while the task has never started.
  Started or completed tasks reject prompt updates; create a replacement task instead.

Task starting:
  task start uses persisted task and project configuration to start the native configured implementation flow.
  Existing dependency, concurrent-start, active-session, workspace, provider, and PTY safeguards remain enforced.

Task listing:
  task list prints compact rows by default for broad scans: id, prompt_preview, status, labels, depends_on, updated_at.
  Pass --full to print complete TaskRow objects.
  task list excludes done tasks unless --state done is passed.

Diagnostics:
  debug process-memory prints read-only Rust sidecar, plugin host V8 heap and bounded lifecycle metrics, and PTY process-tree RSS attribution.
  debug process-memory-history prints the opt-in, totals-only one-hour RSS history.

Task creation hygiene:
  Before creating follow-up Tasks, use project labels list when a project id is known and reuse an existing label when it fits.
  When creating follow-up Tasks, include useful --label values and dependency links when creating related follow-up Tasks.
  For non-linear multi-Task follow-up work, use task plan apply as the preferred workflow for non-linear multi-Task follow-up work so local dependency keys are resolved in one operation.
  For simple follow-up work, link prerequisites immediately with --depends-on or task dependencies link.
  If labels or dependency order are unclear, state that uncertainty instead of guessing.

Examples:
  openforge project labels list --project-id P-1
  openforge debug process-memory
  openforge debug process-memory-history
  openforge task list --project-id P-1
  openforge task start --task-id T-123
  openforge task delete --task-id T-123
  openforge task create --initial-prompt "Correct task prompt" --project-id P-1 --depends-on T-122 --label cleanup
  openforge task dependencies set --task-id T-999 --depends-on T-456,T-122
  openforge task plan apply --file follow-up-plan.json

Environment:
  OPENFORGE_HTTP_PORT  OpenForge HTTP bridge port (default: 17422)
`);
}

export function printCommandHelp(spec) {
  const planJsonHelp = spec.path.join(' ') === 'task plan apply' ? `\nPlan JSON shape:\n  {\n    "projectId": "P-1",\n    "tasks": [\n      { "key": "api", "prompt": "Build API", "labels": ["backend"] },\n      { "key": "ui", "prompt": "Build UI", "dependsOn": ["api", "KVG-1957"] }\n    ]\n  }\n\nPlan JSON fields:\n  projectId is optional when the OpenForge bridge can infer the project; include it when known.\n  tasks[].key is a stable local name used by other tasks in dependsOn.\n  tasks[].prompt becomes the new task prompt; initialPrompt is also accepted.\n  tasks[].labels is optional.\n  dependsOn is where current or prerequisite task IDs go; values may be local keys or existing task IDs.\n` : '';
  const startHelp = spec.path.join(' ') === 'task start' ? `\nTask starting:\n  task start uses persisted task and project configuration and starts the native configured implementation flow.\n  Existing dependency and active-session safeguards remain enforced alongside concurrent-start, workspace, provider, and PTY checks.\n` : '';

  console.log(`OpenForge CLI

Usage:
  ${spec.usage}
${planJsonHelp}${startHelp}
Task prompt semantics:
  task create sets the task's initial_prompt from --initial-prompt.
  task update --initial-prompt updates initial_prompt and prompt together only while the task has never started.
  Started or completed tasks reject prompt updates; create a replacement task instead.

Task creation hygiene:
  Before creating follow-up Tasks, use project labels list when a project id is known and reuse an existing label when it fits.
  When creating follow-up Tasks, include useful --label values and dependency links when creating related follow-up Tasks.
  For non-linear multi-Task follow-up work, use task plan apply as the preferred workflow for non-linear multi-Task follow-up work so local dependency keys are resolved in one operation.
  For simple follow-up work, link prerequisites immediately with --depends-on or task dependencies link.
  If labels or dependency order are unclear, state that uncertainty instead of guessing.
`);
}
