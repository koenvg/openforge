## Why

Scoped Agent Sessions currently run only Claude Code behind a host-owned read-only policy and macOS process sandbox. That blocks the Project's configured provider and suppresses the local skills, plugins, hooks, MCP servers, settings, and normal permission behavior users expect from an Agent Session.

## What Changes

- **BREAKING** Remove `toolPolicy` from scoped-session start requests, remove the `UNSUPPORTED_TOOL_POLICY` error, and delete the stored Session Tool Policy identity without a compatibility shim.
- Launch Scoped Agent Sessions with the Project's configured provider through the same provider adapters and ordinary local configuration used by normal Agent Sessions.
- Support every provider available to normal Agent Sessions, including provider-native conversation identity, continuation, lifecycle reporting, and terminal behavior.
- Remove the Claude-specific `--restricted` launch, tool allowlist, isolated settings and MCP configuration, final read-only authorization hook, and macOS `sandbox-exec` profile.
- Remove the Claude-only authentication preflight and let each configured provider handle authentication, login, and onboarding as it does in a normal Agent Session.
- Let provider-native permissions govern tools and filesystem access. Scoped Workspaces become writable, and a normal provider session may access other local resources allowed by the current OS user and provider configuration.
- Keep Session Scope ownership, host-owned workspace creation and cleanup, bounded scheduling, host-rendered terminals, and scope-bound OpenForge credentials and commands.
- Run pull request review sessions with the same normal configured-provider behavior instead of promising an immutable review checkout.
- Keep the Electron renderer sandbox unchanged; it is unrelated to Agent Session process restrictions.

This change follows `add-scoped-agent-sessions` and `share-agent-auth-with-scoped-sessions`. Their scoped lifecycle and provider-authentication requirements have landed and are synced into the durable specs before this delta replaces the restricted Claude behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plugin-agent-sessions`: Remove caller-selected Session Tool Policies from scoped starts and require the host to run the Project's configured provider with normal local provider behavior.
- `scoped-agent-sessions`: Remove the host-enforced Session Tool Policy from the scoped lifecycle while retaining scope ownership, scheduling, workspace lifecycle, and terminal isolation from Task flows.
- `agent-provider-authentication`: Replace the restricted authentication-only configuration with the configured provider's complete normal local configuration and provider-native login or onboarding flow.
- `pr-review-agent-session`: Replace the read-only review-agent guarantee with a normal configured-provider session whose provider permissions may modify the Scoped Workspace and access other permitted local resources.

## Impact

- Public Plugin SDK request and error types, including removal of the policy and Claude-authentication errors, frontend and backend bridges, CommonAPIFake, packaged runtime declarations, GitHub Sync callers, and plugin authoring documentation.
- Scoped session persistence and migrations, provider selection, provider conversation identity, continuation, process launch, lifecycle hooks, terminal exit handling, and scope-bound agent credentials.
- Normal provider adapters for Claude Code, Codex, Pi, OpenCode, and Grok, plus the shared PTY and hook transport they use.
- Removal of the Session Tool Policy module, restricted Claude adapter and command builder, macOS agent sandbox profile, policy hook entry point, and their tests.
- `CONTEXT.md` language and relationships that currently define Session Tool Policy.
- Backend, Plugin SDK, renderer bridge, provider contract, GitHub Sync, and cross-boundary integration tests.
