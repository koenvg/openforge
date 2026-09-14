## Context

See proposal.md, Why. Requirements are in `specs/agent-lifecycle-hook-transport/spec.md`.

Two constraints shape the approach.

The launcher guarantees a fixed env set to every agent PTY: `OPENFORGE_TASK_ID`, `OPENFORGE_PTY_INSTANCE_ID`, and `OPENFORGE_HTTP_PORT` (`openforge_agent_env` in `src-tauri/src/pty_manager/session/provider_adapter.rs`). `OPENFORGE_AGENT_CONFIG` is not in that set. It is injected per allocation by the Session Daemon, and only production PTYs that the daemon hosts receive it. That is still an unreleased slice.

Grok resolves the variables a hook command names before running it and refuses the hook when any is missing. So a hook command is not a shell script that OpenForge fully controls. It is a contract with the provider about environment, and the provider enforces it.

The embedded notification client already handles both routes. `openForgeNotificationConfig` in `src-tauri/src/agent-notifications/client.js` returns `null` when `OPENFORGE_AGENT_CONFIG` is absent, and `deliverOpenForgeNotification` then posts to the legacy URL with one attempt and no retry. The only reason the shell had to branch is that `shell-hook.js` passes the literal `"unused"` as that URL, so the JS legacy path was unreachable from a shell hook.

## Goals / Non-Goals

**Goals:**

- One transport story per provider, with route selection in one place.
- A generated hook command whose env references are verifiable against the launcher's guarantees at build time, not discovered by a user whose Task stopped moving.

**Non-Goals:**

- Changing accepted envelopes, delivery routes, retry budgets, or session status transitions.
- Bringing Claude Code's hook configuration under the same requirement. See the decision below.
- Any change to how the daemon-hosted path acquires or validates its configuration.

## Decisions

### Route selection moves into the hook process

The generated command drops the `if [ -n "$OPENFORGE_AGENT_CONFIG" ]` wrapper and always invokes the embedded hook. `shell-hook.js` gains the legacy endpoint URL as an argument and passes it to `sendOpenForgeNotification` in place of `"unused"`.

Alternatives considered:

- **Shell default syntax**, `${OPENFORGE_AGENT_CONFIG-}`. One-token change, but it assumes Grok's resolver understands parameter expansion with defaults rather than matching variable names. Unverified, and a wrong guess reproduces the same silent outage. Rejected.
- **Always export the variable** on the legacy path. The client treats an empty value as absent (`if (!path) return null`), so this works only by coincidence, and it puts a credential-shaped variable that points at nothing into every agent environment. Rejected.
- **Move production PTYs onto the daemon path** so the variable is always real. Correct long term, and it is what `preserve-sessions-across-updates` is for. Far too large to carry a status regression fix. Rejected for this change.

### The legacy query string is built in the hook process

The generator passes only the endpoint URL. The hook process reads `OPENFORGE_TASK_ID`, `OPENFORGE_PTY_INSTANCE_ID`, and `GROK_SESSION_ID` from `process.env` and assembles the query itself.

The alternative is to keep the fully-formed URL, query string included, in the command string. That keeps three more variable references in the hook configuration and leaves the same class of defect one commit away. Rejected.

The query's `session_id` stays on `GROK_SESSION_ID` rather than on the envelope's `provider_session_id`, which prefers the `session_id` field of hook stdin. The two are the same value in the ordinary case, but the legacy route persists this field as the resume identity, and hook stdin is a provider-owned shape that may carry a narrower sub-session id. The previous curl command sent the environment variable, and a fix for a status regression is the wrong place to change what gets persisted for resume. The divergence is deliberate and carries a comment.

### Unreadable hook stdin does not drop the lifecycle event

The hook process reads stdin before it reports. Oversized input, over 65536 bytes, and input that is not JSON both degrade to an empty object, and the report still goes out. Grok's `PostToolUse` stdin carries `tool_response`, so one large file read can exceed the bound; the previous curl command posted regardless of what it piped. Identity comes from the environment, not from stdin, so there is nothing the event needs that a failed read would supply.

### The `$OPENFORGE_TASK_ID` guard stays

It is the one variable the launcher guarantees on every path, and its absence means the agent is not running under OpenForge. Grok dropping the hook there is the wanted outcome, so the guard keeps doing useful work rather than relying on the JS early return.

### Claude Code keeps its shell branch

Grok's legacy route reads identity from the query string only and ignores the request body (`handle_grok_hook` in `src-tauri/src/http_server/legacy_transport/hook_routes.rs`). Claude Code's legacy route deserializes the body into `ClaudeHookPayload` and uses it twice: `transcript_path` and `background_tasks` feed background-work deferral, and the whole payload is republished as a `claude-hook-event` app event.

Switching Claude Code to the same transport would post the normalized envelope where raw hook stdin is expected. `transcript_path` and `background_tasks` would survive, because the envelope already carries them, but `tool_name` and `tool_input` would drop off that app event. No consumer of `claude-hook-event` exists anywhere in the repository, so the loss is currently unobservable, which is exactly why it is not worth taking: Claude Code is not broken, and the change buys nothing.

The cost is a known deviation. Claude Code's generated configuration still names `$OPENFORGE_AGENT_CONFIG`, which the requirement forbids, and the subset test therefore covers Grok only. That gap is tracked as a follow-up rather than hidden.

The alternative was to add a separate legacy-body argument to `sendOpenForgeNotification`, so each adapter could post its provider's raw stdin to the legacy route and keep that contract byte-identical. It is the right shape if Claude Code ever moves, but it widens shared client code that pi, opencode, and codex also use, for a provider that reports correctly today. Deferred with the follow-up.

### The regression test pins the command exactly

The shell-visible part of a generated Grok command is 120 characters that OpenForge writes itself. The generator test splits the single-quoted embedded source out of the command and asserts the remainder equals an exact expected string, per event.

Alternatives considered:

- **Assert `$OPENFORGE_AGENT_CONFIG` is absent.** Passes for the next variable someone adds. Rejected.
- **Extract every referenced variable with a small shell lexer and assert a subset of an allowed set.** This was implemented first and then removed. It needed a hand-rolled tokenizer in a production module to read a string the same module generates, it restated the launcher's env set a fifth time, and it failed open on a single quote inside a double-quoted word, which is the exact defect class the test exists to catch. Rejected.

The exact pin is strictly stronger and carries no machinery: it rejects any new variable reference, any stdout write, a lost `>/dev/null` or `; exit 0`, a wrong argument order, and a wrong port or endpoint, in one assertion per event. It cannot fail open, because any unexpected text is a diff.

### The generated Grok command redirects stdout to `/dev/null`

Grok reads `PreToolUse` stdout as a permission decision. The embedded hook writes diagnostics to stderr only, so the redirect is currently redundant, which is why it is at the shell level: it is a guarantee about the command rather than a property of the JavaScript inside it. The removed curl command had the same guarantee as `-o /dev/null`, and asserting the absence of `process.stdout` and `console.log` in the source text was a weaker substitute (`console.info`, `console.debug` and `fs.writeSync(1, ...)` all pass it).

## Risks / Trade-offs

- **Node now starts on every legacy hook, where curl used to run.** Node startup is heavier, and `PreToolUse` and `PostToolUse` fire on every tool call. Mitigation: measure hook wall time on a tool-heavy Grok session before closing. If it is material, the answer is a smaller legacy sender, not a return to branching in the config.
- **Grok may also require variables OpenForge does not set.** The generated command now names `$OPENFORGE_TASK_ID` only, so the exposure is one variable the launcher always sets. Mitigation: confirm against a real Grok run.
- **Running sessions keep the broken hook.** Hook files are rewritten at agent launch, so an already-running Grok session stays silent until it restarts. Mitigation: state it in the change notes. No in-place repair of a live session.
- **One provider stays outside a requirement this change introduces.** Claude Code's configuration still names a variable absent on the legacy path. Mitigation: a follow-up carries it, and the deviation is stated in the proposal's Impact rather than left for a reader to discover from a test that quietly skips a provider.
- **The legacy path now depends on `node` being on PATH, where it depended on `curl`.** macOS ships curl and not node. `user_environment` merges node-manager bin directories into the agent PATH, and the Claude Code daemon path already relies on this, so the dependency is not new to the product; it is new to Grok's legacy path. A miss is silent, because `; exit 0` swallows it. Mitigation: the real-Grok run in task group 4 exercises the resolved PATH.

## Migration Plan

No data or schema migration. Hook configurations are regenerated at each agent launch, so the next Grok start replaces `~/.grok/hooks/openforge.json`. Rollback is a revert of the generator plus one Grok launch.
