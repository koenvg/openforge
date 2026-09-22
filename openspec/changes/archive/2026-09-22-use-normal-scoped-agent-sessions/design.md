## Context

See `proposal.md` for motivation. `add-scoped-agent-sessions` introduced a provider-neutral domain model but its runtime is not provider-neutral: `ScopedAgentSessionService` delegates to a Claude-only runtime, the start request and database row carry `tool_policy`, and the PTY layer has a separate sandboxed Claude adapter. `share-agent-auth-with-scoped-sessions` lets that runtime reuse Claude authentication while continuing to suppress the rest of the user's configuration.

Normal Task Agent Sessions already dispatch through the `Provider` enum and the Claude Code, Codex, Pi, OpenCode, and Grok PTY adapters. Those adapters own provider command construction, local hook or extension setup, conversation identifiers, environment, and resume behavior. Their lifecycle transports currently identify Task ownership through `OPENFORGE_TASK_ID`, while the restricted Claude runtime has a separate scoped lifecycle script and endpoint.

Scoped storage already has one generic `provider` and `provider_session_id` pair, one host-owned workspace per scope and revision, a scoped PTY exit policy, and a short-lived credential bound to the owning plugin and exact Session Scope. Those pieces remain useful without a Session Tool Policy.

The two predecessor changes are complete and synced into the durable spec set. This change updates those requirements to remove the restricted Claude behavior.

## Goals / Non-Goals

**Goals:**

- Make provider launch and continuation reusable by Task-owned and Scoped Agent Sessions without constructing fake Tasks or provider-specific database rows.
- Keep lifecycle events, provider conversation identity, PTY exit, and scoped credentials attributable to the exact session and current PTY instance.
- Remove the read-only policy and macOS agent sandbox as concepts, not rename them to a permissive policy.
- Keep the breaking SDK, host, database, bundled plugin, and documentation changes atomic inside this repository.

**Non-Goals:**

- Turning a Scoped Agent Session into a Task or Implementation Run.
- Letting a plugin select a provider, agent, model, permission mode, executable, settings file, or workspace path per request.
- Preserving `toolPolicy`, `review-read-only`, `UNSUPPORTED_TOOL_POLICY`, or `AUTHENTICATION_UNAVAILABLE` compatibility.
- Preserving scoped sessions across application restart or changing queue and workspace limits.
- Changing the Electron renderer sandbox or treating a normal provider process as an OS security boundary.

## Decisions

### 1. Separate provider execution from Task ownership

Refactor the provider layer around an internal provider-session launch input that contains a terminal key, workspace, prompt, optional provider conversation identity, continuation intent, normal provider run options, presentation context, lifecycle ownership, and PTY exit observer. Task start and follow-up will adapt their Task and `AgentSessionRow` data into that input. Scoped start and input will adapt the `ScopedAgentSessionRow` instead.

The PTY manager will expose the same normal provider adapters to both owners and choose `TaskAgent` or `ScopedAgent` exit handling from the launch input. The dedicated `ScopedClaudeCodePtyAdapter`, `spawn_scoped_claude_pty`, and `build_scoped_claude_args` path will disappear.

This keeps command construction and provider preparation in one place. Calling the existing Task launcher with a synthetic Task was rejected because it would leak scoped work into Task persistence, attention, startup resume, and Task-only credentials. Maintaining five new scoped provider adapters was rejected because their normal and scoped behavior would drift.

### 2. Resolve and pin the Project provider at scoped admission

The service will resolve the Project's effective provider before reserving a session and store that provider on the scoped row. Later turns use the stored provider even if Project configuration changes, matching the existing rule that one Scoped Agent Session is one provider conversation. A new revision or released-and-restarted scope resolves the current Project provider again.

The scoped API supplies no agent, model, or permission override. The normal provider adapter and its local configuration determine those values. Provider-native authentication, login, onboarding, trust prompts, and permission prompts remain visible in the mounted terminal. OpenForge will remove the Claude-only authentication preflight rather than invent equivalent preflights for every provider.

Keeping a `normal` policy name was rejected. There is no caller choice left, and retaining the field would preserve a misleading security contract.

### 3. Normalize provider conversation identity and continuation

Scoped storage will keep its generic `provider_session_id`. The provider layer will normalize identities produced synchronously at launch, such as Pi's host-created ID, and identities reported later by provider hooks or extensions. Task persistence may retain its provider-specific columns, but conversion between a Task row and the provider-neutral launch input belongs at the Task boundary.

Continuation will prefer the stored explicit identity. When a provider exposes only a workspace-local continuation operation, the adapter may use it because a Scoped Workspace belongs to one unreleased Scoped Agent Session and scoped execution serializes that session's provider process. If an adapter cannot identify or safely continue the same conversation, it must fail the follow-up instead of starting or selecting an unrelated conversation.

This preserves the existing same-conversation contract while allowing providers such as Codex to use their native continuation model.

### 4. Extend provider lifecycle bridges with scoped ownership

Keep the separate scoped lifecycle endpoint and scoped credential authentication. Extend the normal Claude settings hook, Codex hook, Pi extension, OpenCode plugin, and Grok hook transport to recognize scoped ownership through host-injected scoped environment values. Task launches continue to send Task lifecycle events unchanged. Scoped launches send normalized provider, lifecycle kind, raw event type, provider conversation identity, PTY instance, and stable turn identity to the scoped endpoint.

The endpoint derives plugin, Project, and Session Scope ownership from the authenticated principal. Provider payloads cannot claim those values. It validates the current PTY instance before recording a turn transition or provider identity, so output and hooks from a replaced process remain stale.

Move scoped lifecycle reporting out of the generated Claude policy settings. This lets Claude load the standard OpenForge lifecycle settings alongside its ordinary setting sources and gives every provider the same ownership rule. Provider bridges may generate and retain a turn identity from their native prompt events; the host must treat one identity consistently until the matching idle or end event.

A single owner-polymorphic public hook payload was considered but rejected. Keeping Task and scoped endpoints separate avoids broadening legacy Task routes and keeps scoped credential middleware authoritative.

### 5. Keep OpenForge host authority scoped even though the process is unrestricted

Remove `tool_policy` from `ScopedAgentPrincipal`. Agent ingress will continue to match session ID, owner plugin, Project, namespace, target key, revision, current status, and credential lifetime. The fixed scoped route allowlist and the exact-scope checks for Review Threads remain. Scoped Plugin Command invocation remains limited to the walkthrough submission command, but authorization will follow the scoped principal type rather than a `review-read-only` string.

Every scoped provider adapter will remove inherited Task and controller credentials before adding the short-lived `OPENFORGE_AGENT_CONFIG`. Removing the process sandbox intentionally gives the provider the current OS user's ordinary local authority; it does not grant a controller credential or relax OpenForge HTTP authorization.

### 6. Make the public and stored contract a clean break

Remove `toolPolicy` from the SDK request, renderer IPC wrapper, generated registry, plugin-host callback, CommonAPIFake, GitHub Sync, docs, fixtures, and contract tests. Remove `UNSUPPORTED_TOOL_POLICY` and the Claude-specific `AUTHENTICATION_UNAVAILABLE` error. Raw host inputs will reject the removed field so an old caller cannot mistake a normal session for a read-only one.

Rebuild `scoped_agent_sessions` without `tool_policy`, copying every remaining column and index. Existing session rows and workspaces can remain; normal startup reconciliation already marks live scoped sessions interrupted. No data conversion to a replacement policy value is needed.

Update `CONTEXT.md` to remove Session Tool Policy and the relationship that lets a plugin select one. Replace it with the rule that the Project selects the provider, the provider runs normally, and OpenForge separately limits the scoped credential.

### 7. Delete the restricted Claude runtime after provider parity exists

Once all normal providers pass scoped start, continuation, lifecycle, abort, and cleanup tests, remove the Session Tool Policy module, policy hook executable entry point, sandbox profile generation, Claude launch-context sandbox allowances, private restricted settings generation, Claude-only scoped authentication check, and their tests.

The resulting scoped launch calls provider executables directly through the normal adapters. This also removes the current macOS-only policy guard, so scoped sessions work wherever the selected normal provider and OpenForge PTY runtime already work.

The Electron `webPreferences.sandbox` setting remains untouched.

## Risks / Trade-offs

- [Normal provider processes can read or change files outside the Scoped Workspace and use the network] -> Document that Scoped Agent Sessions run with the same local authority as normal Agent Sessions. Keep the scoped OpenForge credential narrow and never describe the workspace as a security sandbox.
- [User hooks, plugins, skills, or MCP servers can change behavior or leak review data] -> Treat this as the intended normal-session contract, show provider interactions in the terminal, and keep host credentials and routes scope-bound.
- [Provider lifecycle events differ and can misattribute state] -> Normalize events at each provider bridge, authenticate scoped delivery, require the current PTY instance, and add shared contract fixtures plus provider-specific integration tests.
- [A provider without a durable conversation ID may continue the wrong session] -> Permit workspace-local continuation only when the adapter can prove the workspace is exclusive to that Scoped Agent Session; otherwise fail the follow-up.
- [Refactoring shared provider launch can regress Task Agent Sessions] -> Keep Task behavior behind adapter tests and run the full Backend Crate and affected renderer and Plugin SDK checks.
- [Removing a SQLite column makes downgrade to an older binary unsafe] -> Treat the migration as one-way, like other schema migrations. Rollback requires restoring a pre-migration database backup or shipping a forward repair migration.
- [The predecessor changes introduced requirements that this change supersedes] -> Keep their synced durable requirements and this change's removal and modification deltas coherent, then validate the resulting capability set for contradictory read-only requirements.

## Migration Plan

1. Add failing SDK, database, provider, lifecycle, and GitHub Sync tests for the policy-free request and normal configured-provider behavior.
2. Introduce the provider-neutral launch and lifecycle ownership contracts while keeping Task launches behaviorally unchanged.
3. Move scoped launches to every normal provider adapter, persist normalized conversation identity, and verify provider-specific continuation and stale-event rejection.
4. Remove the policy and authentication fields and errors across the SDK, host bridges, scoped credential, SQLite schema, CommonAPIFake, bundled plugin, docs, and domain language.
5. Delete the restricted Claude runtime, sandbox, policy hook, and special command path after the provider matrix passes.
6. Run full affected-system validation because the change crosses SDK, IPC, database, provider process, lifecycle, credential, and plugin boundaries.

The repository ships the SDK, host, database migration, and bundled GitHub Sync update together. There is no mixed-version compatibility phase. If rollout must be reverted after migration, restore a pre-migration database backup or ship a forward repair; do not run an older binary against the migrated database.
