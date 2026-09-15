## Why

`fix-grok-lifecycle-hook-env-guard` introduced the rule that an installed hook configuration names only environment the launcher guarantees, then exempted Claude Code from it. The exemption exists in the spec text, so a reader finds a requirement with a standing counter-example and no date on it.

Claude Code is not broken today: it does not validate the environment a hook command names, so its `if [ -n "$OPENFORGE_AGENT_CONFIG" ]` branch reaches the `else curl` arm on the legacy launch path. The defect is that the rule has an exception, and the next provider that copies Claude's generator inherits the same silent failure Grok had.

The exemption was bought by one thing: Claude's legacy route deserializes the request body into `ClaudeHookPayload`, where Grok's ignores it. `tool_name` and `tool_input` feed the activity snapshot that names an untitled Task, and `background_tasks` plus `transcript_path` feed background-work deferral. Posting the normalized envelope there would drop the first two.

## What Changes

- `sendOpenForgeNotification` takes an optional raw legacy body. When present it is posted to the legacy listener in place of the normalized envelope. The 16384-byte bound moves to after route selection and applies to the envelope only, so a hook body larger than that still reports.
- `shell-hook.js` passes Claude's own hook stdin as that body. Grok keeps posting the envelope, because its legacy route reads none of it.
- `claude_hooks::lifecycle_hook_command` emits one `node` invocation and names no environment variable at all. Route selection moves into the hook process, where it already lives for every other provider.
- Claude's command keeps `>/dev/null`, which the removed `curl -o /dev/null` carried, and takes no `; exit 0`. Claude reports a non-zero hook exit as a non-blocking warning, so a missing `node` stays visible.
- The Claude generator gets the exact-command pin that Grok has. The two subset tests now cover every shell-hook provider.

Not breaking. The legacy route receives the same URL, the same content type, and the same JSON value it receives today.

## Capabilities

### Modified Capabilities
- `agent-lifecycle-hook-transport`: the guaranteed-environment requirement loses its Claude Code exemption, and Claude Code gains the reporting requirement Grok has.

This change archives after `fix-grok-lifecycle-hook-env-guard`, which introduces the capability it modifies.

## Impact

Affected code:

- `src-tauri/src/claude_hooks.rs`, `lifecycle_hook_command` and its generator tests
- `src-tauri/src/agent-notifications/client.js`, `sendOpenForgeNotification` and `deliverOpenForgeNotification`
- `src-tauri/src/agent-notifications/shell-hook.js`, the legacy body for Claude

Affected behavior:

- Claude Code's legacy hook path runs `node` where it ran `curl`. Same request.
- Hook stdin over 65536 bytes degrades to `{}`, where `curl` posted it whole. That costs the activity snapshot its `tool_name` and `tool_input` for that one event; the lifecycle event itself still reports, because identity comes from the environment.
- Installed hook files are rewritten at agent launch, so a running Claude session keeps the branching command until it restarts.

Out of scope:

- Moving production PTYs onto the daemon-hosted path. That stays with `preserve-sessions-across-updates`.
- The legacy URL baking in the HTTP bridge port when the hook file is written. Same defect Grok has, same separate change.
- `claude-hook-event`, which still republishes the raw payload and still has no consumer in the repository.
