## Why

Grok Tasks stopped moving to in progress, and their completion, waiting-for-permission, and session-end signals stopped arriving. Commit `ce1cabf1` (KVG-4719) added `$OPENFORGE_AGENT_CONFIG` to the generated Grok hook command, but that variable is set only on the daemon-hosted PTY path, which production launches do not use. Grok treats every variable a hook command names as required, so it drops the hook with `hook not executed: required env var(s) not set` before any shell runs, and the command's own `else curl` fallback is unreachable.

## What Changes

- Generated provider hook commands stop naming `$OPENFORGE_AGENT_CONFIG`. Route selection stays inside the hook process, where the embedded notification client already reads `process.env.OPENFORGE_AGENT_CONFIG` and falls back to the legacy listener when it is absent.
- `shell-hook.js` receives the legacy endpoint URL as an argument and builds the full legacy request itself, including the task, PTY instance, and session query values. It no longer receives the literal `"unused"` while the shell assembles that URL.
- The Grok hook generator emits a single `node` invocation instead of a shell `if`/`else` over the private configuration path.
- Grok keeps its `$OPENFORGE_TASK_ID` guard. Outside OpenForge that variable is absent, and Grok dropping the hook is the wanted outcome rather than a failure.
- Regression coverage asserts that a generated hook command names only variables the PTY launcher guarantees, so a future transport branch cannot silently disable a provider's reporting again.

Claude Code keeps its shell branch. Its legacy route reads the request body, so switching its transport would change what that route receives for no gain, since Claude Code does not validate env references and is not broken. See design.md.

Not breaking. Accepted lifecycle envelopes, routes, and session state transitions are unchanged. This restores delivery on a path that already existed.

## Capabilities

### New Capabilities
- `agent-lifecycle-hook-transport`: what an installed provider hook command may depend on, and where the choice between the durable daemon route and the legacy listener is made.

### Modified Capabilities

None. No accepted-envelope, route, or session-status requirement changes.

## Impact

Affected code:

- `src-tauri/src/grok_hooks.rs`, `lifecycle_hook_command`
- `src-tauri/src/agent-notifications/shell-hook.js`
- `src-tauri/src/notification_hooks.rs`, for the generated argument list

Affected behavior:

- Grok lifecycle reporting starts working again on the legacy launch path. Claude Code is untouched.
- Installed hook files are rewritten on the next agent launch, so `~/.grok/hooks/openforge.json` carries the stale command until then.

Out of scope:

- Moving production PTYs onto the daemon-hosted path. That stays with `preserve-sessions-across-updates`.
- The Grok legacy URL baking in the HTTP bridge port when the hook file is written, so a later port change is missed. Separate defect, separate change.
- Bringing Claude Code's hook configuration under the new requirement. Tracked as a follow-up.
