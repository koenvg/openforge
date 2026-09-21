## Context

See `proposal.md` for the user-facing failure. Normal Task agents launch with `user_environment()`, so Claude sees the user's login-shell environment and normal credential storage. `ScopedClaudeCodePtyAdapter` currently replaces `CLAUDE_CONFIG_DIR` with a fresh `provider-state` directory. Claude treats that variable as the root for credentials as well as conversation data, which turns the scoped process into a separate, unauthenticated Claude installation.

The scoped launch already excludes user and Project setting sources, supplies a host settings file, disables slash commands, supplies an empty strict MCP configuration, and runs inside a macOS sandbox. Those controls can stay independent from authentication. The current lifecycle hook incorrectly uses `CLAUDE_CONFIG_DIR` for its own turn marker, so that marker must move before the override can be removed.

`add-scoped-agent-sessions` introduces the runtime, policy, and lifecycle that this change adjusts. Implementation and archive order must preserve that dependency.

## Goals / Non-Goals

**Goals:**

- Give scoped and normal Task launches one canonical effective Claude user environment for authentication.
- Keep OpenForge policy files, lifecycle markers, temporary files, and scope-bound OpenForge credentials private to the scoped session.
- Preserve the process-level prohibition on Scoped Workspace writes.
- Fail with a stable authentication error before Claude can show onboarding.
- Keep conversation IDs unique across normal and scoped sessions.

**Non-Goals:**

- Import personal Claude permissions, hooks, plugins, MCP servers, commands, memory, or tool configuration.
- Read, copy, export, transform, or persist Claude OAuth tokens or API keys in OpenForge storage.
- Change authentication for normal Task Agent Sessions.
- Add scoped support for a provider and Session Tool Policy combination that is not already supported.
- Delete Claude-owned conversation history from the user's provider store when OpenForge releases a scoped session.

## Decisions

### 1. Reuse the effective user environment instead of copying credentials

Add a Claude launch-context resolver that starts from the same process and login-shell environment used by Task agent PTYs. It returns the executable, final environment, effective configuration paths, and authentication readiness needed by both preflight and spawn. The scoped adapter removes Task-only OpenForge credentials as it does today, but it stops adding its own `CLAUDE_CONFIG_DIR`.

The resolver must preserve a user-supplied `CLAUDE_CONFIG_DIR`, API credential variables, and supported cloud-provider variables because a normal Task agent receives them. When the variable is absent, Claude uses its normal home-directory credential context. No credential value may enter logs, errors, database rows, event payloads, or Plugin SDK results.

Use the same resolved context for `claude auth status` and the eventual PTY. A check that inherits a different environment would recreate the bug at a less visible boundary.

Alternatives considered:

- Copying or linking credential files into the private directory couples OpenForge to Claude's private file and Keychain formats. It also duplicates secrets and breaks token refresh.
- Asking users for `CLAUDE_CODE_OAUTH_TOKEN` creates a second login path even though the normal agent is already authenticated.
- Sharing the entire user settings source would fix login but would let personal policy widen the scoped session.

### 2. Separate OpenForge state from Claude's configuration root

Rename the current private provider-state concept to scoped runtime state. It continues to contain the generated host policy, lifecycle turn marker, temporary directory, and other OpenForge-owned ephemeral files. Export its path as `OPENFORGE_SCOPED_STATE_DIR`. The lifecycle hook reads that variable instead of `CLAUDE_CONFIG_DIR`.

Claude stores its provider conversation under its normal effective configuration root and the host continues to pass a generated UUID with `--session-id` or `--resume`. The UUID is the ownership boundary for conversation selection. OpenForge deletes only its scoped runtime state on failed launch, release, and startup cleanup. Claude-owned history follows Claude's normal retention behavior, the same as Task agent history.

This trades physical directory isolation for supported authentication and refresh behavior. Logical conversation isolation remains explicit and testable.

### 3. Keep configuration exclusion in command arguments and the host policy

The scoped command keeps these controls:

- `--setting-sources ""`
- the host-generated `--settings` file
- `--strict-mcp-config` with an empty MCP configuration
- `--disable-slash-commands`
- the host tool list, permission mode, restricted mode, and PreToolUse authorization hook

The policy generator removes `MultiEdit` from its deny list because current Claude releases no longer expose that tool and print a warning for unknown rule names. Removing the stale name does not grant a tool. The wildcard PreToolUse hook still denies every tool outside the closed allowlist.

Authentication establishes who can call the provider. These command and hook controls establish what the session can do. Neither side substitutes for the other.

### 4. Allow provider-owned state writes without allowing workspace writes

Extend the macOS sandbox profile with the effective Claude state paths resolved from the same launch context. For the default configuration, this covers Claude's user state directory and global state file. For a user-supplied configuration root, it covers that root. The existing private scoped runtime state remains writable.

Before generating the profile, canonicalize existing ancestors and reject any provider state path that overlaps the Scoped Workspace or resolves to an unsafe broad directory such as the home directory itself. Symlink checks must prevent a permitted state path from redirecting into the workspace. The sandbox continues to deny every other file write, including all writes below the Scoped Workspace.

Allowing Claude's state root is broader than the current fresh directory. The tool boundary remains narrow because file-writing tools are unavailable, Bash uses a closed read-only grammar, personal settings are not loaded, and the final host hook evaluates every tool call. Integrated tests must still compare the checkout before and after approved mutation attempts.

### 5. Check authentication at admission and immediately before spawn

Add provider readiness to the scoped runtime boundary. For Claude, run a bounded `claude auth status` with output discarded and with the exact resolved launch environment. Check before admitting a new start so an unauthenticated request does not occupy queue or workspace capacity. Check again when a queued start is promoted, when a completed conversation continues, and immediately before spawn because credentials can change while a request waits.

Return a stable `AUTHENTICATION_UNAVAILABLE` category with an instruction to authenticate the normal provider. Do not expose provider output because it can contain account details. A credential that expires after the final check remains a normal provider launch failure.

### 6. Test the environment boundary, not credential contents

Unit tests use fake environment maps and fake auth probes. They prove that the probe and command receive the same credential-related environment, that OpenForge Task credentials are removed, and that no value reaches diagnostics.

The macOS integration fixture uses an authenticated fake Claude executable rather than real user credentials. It records only environment key names and selected non-secret paths, creates provider conversation state, and verifies that the scoped launch skips onboarding. The existing policy tests remain responsible for denied edits, denied shell mutation, user approval, and checkout hashes.

## Risks / Trade-offs

- [Claude changes which state paths it writes] -> Keep path resolution in the Claude adapter, cover supported layouts with fixtures, and fail closed when the sandbox denies an unknown write.
- [A custom configuration root overlaps the checkout] -> Reject the scoped start with an actionable unsafe-configuration error instead of widening the sandbox.
- [Authentication changes between preflight and request execution] -> Recheck before every spawn and report provider failures without retrying under another identity.
- [Writable provider state gives the provider process access to shared Claude state] -> Exclude personal configuration sources, keep tool authorization closed, never expose the path to plugins, and retain the process sandbox around the workspace.
- [A follow-up change archives before its prerequisite] -> Record the dependency in the proposal and validate or archive only after `add-scoped-agent-sessions` has established its terms and behavior.

## Migration Plan

1. Land and sync `add-scoped-agent-sessions` first.
2. Add the shared launch-context resolver and authentication probe behind the scoped Claude adapter.
3. Move lifecycle markers to `OPENFORGE_SCOPED_STATE_DIR`, then remove the scoped `CLAUDE_CONFIG_DIR` override.
4. Expand and verify the sandbox state allowlist before enabling authenticated scoped launches.
5. Remove stale scoped runtime directories during the existing startup cleanup. Scoped sessions are already interrupted across restart, so no live provider-state migration is required.

Rollback restores the isolated configuration directory. That disables credential reuse again but does not modify or remove the user's normal Claude login.
