## Context

See proposal.md, Why. Requirements are in `specs/agent-lifecycle-hook-transport/spec.md`.

`fix-grok-lifecycle-hook-env-guard` moved Grok's route selection into the hook process and left Claude Code's shell branch in place, recording the gap as a deviation in the requirement itself and naming the follow-up. This is that follow-up. The alternative it deferred, a separate legacy-body argument on `sendOpenForgeNotification`, is what this change implements.

## Goals / Non-Goals

**Goals:**

- One transport story for every provider, with no exemption in the requirement.
- Claude Code's legacy route receives the request it receives today: same URL, same content type, same body.

**Non-Goals:**

- Changing accepted envelopes, delivery routes, retry budgets, or session status transitions.
- Changing what the daemon-hosted path sends. Claude's envelope there is unchanged and still carries no `tool_name`.
- Giving `claude-hook-event` a consumer, or removing it.

## Decisions

### The raw provider body is an argument, not a provider branch in the client

`sendOpenForgeNotification(payload, legacyUrl, legacyBody)`. When `legacyBody` is present and there is no private configuration, it is the request body. It is a string, re-serialized by the caller from the JSON it parsed, so the listener sees the same value rather than the same bytes. The client stays provider-agnostic: it does not know which providers have a body-reading legacy route, only that this call has a body to forward.

`shell-hook.js` decides, because that is where the provider is already known. Grok passes nothing and keeps posting the envelope, which its route ignores anyway.

Alternatives considered:

- **Teach the Claude legacy route to accept the normalized envelope.** Serde would accept it, and `transcript_path` and `background_tasks` survive, so deferral would keep working. `tool_name` and `tool_input` would not, and they feed the activity snapshot that names an untitled Task. That is a live consumer, unlike `claude-hook-event`. Rejected.
- **Post the envelope and keep a second request with the raw body.** Two requests per hook on the hottest path in the product, to preserve one snapshot field. Rejected.

### The 16384-byte bound moves to after route selection

The bound was taken twice: once in `sendOpenForgeNotification`, before the route was known, and again in `deliverOpenForgeNotification`. The early copy is the one that matters here, because Claude's stop payload puts `background_tasks` into the envelope as well as into the raw body. A stop with a few hundred entries inflates the envelope past the bound, and the send is rejected before either route is chosen. The removed `curl --data-binary @-` posted it, so leaving the early bound in place would lose the Stop event outright and complete an Agent Session with background work in flight.

So the early copy is deleted and the surviving one runs after the route is chosen, on the envelope only. The raw body is not unbounded: `readOpenForgeShellHookInput` caps hook stdin at 65536 bytes and degrades to `{}` past that.

Applying the bound to the raw body instead was the first shape, and it fails the same way for `tool_input`, which routinely exceeds 16384 bytes on a file write.

### Oversized hook stdin costs the snapshot, not the event

Claude's `PostToolUse` stdin carries `tool_response`, so a large file read exceeds 65536 bytes and the hook posts `{}`. Identity comes from the environment and travels in the query string, so the lifecycle event still reports and deferral still works: a `Stop` payload is small, and the bound only bites on tool events.

The cost is `tool_name` and `tool_input` missing from the activity snapshot for that one event. The snapshot exists to help name an untitled Task, and the same refresh reads the transcript. Accepted rather than raising the bound for one provider.

### No `; exit 0`, unlike Grok

Grok needs it because Grok reads exit code 2 as a permission denial and the generated command must never produce one. Claude reads a non-zero hook exit as a non-blocking error and shows it, which is the observability the requirement's dropped-hook scenario wants: `node` missing from the agent's PATH becomes a visible error instead of a Task that quietly stops moving. Node has no exit path that reaches 2 here; the hook's own `main` catches everything and returns.

`>/dev/null` stays, for the same reason it is on Grok's command: Claude reads `PreToolUse` stdout as a permission decision, and the redirect is a guarantee about the command rather than a property of the JavaScript inside it.

### The generator test is the same exact pin Grok has

`claude_hook_commands_are_exactly_the_reporter_invocation` splits the single-quoted embedded source out of each generated command and asserts the remainder equals an exact expected string, per event, including the empty prefix. Same reasoning as Grok's: it rejects any new variable reference, any stdout write, a wrong argument order, and a wrong port or endpoint, and it cannot fail open.

## Risks / Trade-offs

- **Node starts on every Claude hook, where curl used to run.** `PreToolUse` and `PostToolUse` fire on every tool call, so this is the product's hottest hook path. Same risk `fix-grok-lifecycle-hook-env-guard` took for Grok, now on a busier provider. Mitigation: measure hook wall time on a tool-heavy session; the answer to a material cost is a smaller legacy sender, not a return to branching in the config.
- **Running sessions keep the branching command.** `~/.openforge/claude-hooks-settings.json` is rewritten at agent launch, so a live session is unaffected until it restarts. It keeps working, because the old command is not broken.
- **A 5xx from the legacy route is now written to stderr.** `curl -s` swallowed it. The hook still exits 0, so Claude does not surface the line, but it is new text in the hook's stderr.
- **The legacy path now needs `node` on PATH, where it needed `curl`.** Claude's daemon path already depends on it, and `user_environment` merges node-manager bin directories into the agent PATH, so the dependency is not new to the provider.

## Migration Plan

No data or schema migration. The hook configuration is regenerated at each agent launch. Rollback is a revert of the generator plus one Claude launch.
