## 1. Lock the breaking contracts with tests

- [x] 1.1 Add failing Plugin SDK, CommonAPIFake, frontend host, backend host, and packaged-runtime contract tests for a scoped start without `toolPolicy`, removal of policy and authentication error codes, and rejection of a legacy raw `toolPolicy`; verify the focused TypeScript tests fail only on the old contract
- [x] 1.2 Add failing database migration and store tests that remove `tool_policy` while preserving every other scoped session field, row, index, and workspace relationship; verify the focused Rust database tests fail on the current schema
- [x] 1.3 Add failing provider-runtime contract tests for Project provider selection, normal launch arguments and environment, provider pinning, provider-native conversation identity, safe continuation, abort, cleanup, and scoped PTY exit handling across Claude Code, Codex, Pi, OpenCode, and Grok; verify the focused Rust provider tests expose the Claude-only runtime
- [x] 1.4 Add failing lifecycle bridge tests for Task and scoped ownership, provider conversation identity capture, stable turn identity, current-instance filtering, and provider events from Claude Code, Codex, Pi, OpenCode, and Grok; verify stale or cross-owner events fail before implementation
- [x] 1.5 Add failing scoped credential tests that remove policy identity, strip inherited Task and controller credentials, allow the exact scoped Review Thread and walkthrough routes, and reject another scope or host route; verify focused ingress and command-broker tests fail on policy coupling

## 2. Share normal provider execution

- [x] 2.1 Introduce a provider-neutral launch and continuation input with explicit lifecycle ownership, adapt Task start and follow-up to it, and verify existing Task provider and command-building tests remain unchanged
- [x] 2.2 Let the PTY layer run each normal provider adapter with either Task or Scoped Agent exit handling and owner-specific environment, then verify PTY spawn, process exit, retained output, and current-instance tests pass
- [x] 2.3 Normalize synchronous and hook-reported provider conversation identities and implement deterministic explicit or workspace-local continuation for every supported provider; verify the provider matrix resumes the intended conversation and refuses ambiguous continuation

## 3. Replace the scoped Claude runtime

- [x] 3.1 Change scoped admission to resolve and pin the Project provider without a policy or Claude authentication preflight, then verify service tests cover missing Projects, unavailable providers, queue admission, later Project configuration changes, and provider-native login flow
- [x] 3.2 Implement scoped start, continuation, abort, cleanup, output, and exit observation through the shared normal provider path for Claude Code, Codex, Pi, OpenCode, and Grok; verify fake-provider integration tests cover one complete multi-turn lifecycle per provider
- [x] 3.3 Extend the Claude settings hook, Codex hook, Pi extension, OpenCode plugin, and Grok hook transport with authenticated scoped ownership and normalized lifecycle payloads; verify provider-specific hook tests and scoped lifecycle endpoint tests pass without changing Task event behavior
- [x] 3.4 Remove policy identity from scoped credentials and ingress checks while retaining exact session, plugin, Project, scope, route, status, and credential-lifetime checks; verify scoped agent HTTP integration tests prove normal local tools cannot widen OpenForge host authority

## 4. Remove policy from storage and public APIs

- [x] 4.1 Rebuild the `scoped_agent_sessions` table without `tool_policy`, update row and query types, and verify migration tests preserve existing rows and mark previously live sessions through the normal startup reconciliation path
- [x] 4.2 Remove policy and Claude-authentication fields and errors from Rust request parsing, camelCase IPC payloads, plugin-host callbacks, renderer wrappers, and generated Electron contracts; verify raw `toolPolicy` input is rejected before allocation and `pnpm electron:contract:check` passes
- [x] 4.3 Remove `toolPolicy`, `UNSUPPORTED_TOOL_POLICY`, and `AUTHENTICATION_UNAVAILABLE` from Plugin SDK types, CommonAPIFake behavior, generated declarations, fixtures, and packaged runtime; verify the Plugin SDK test, build, and published-contract scripts pass

## 5. Update the bundled review flow and delete restrictions

- [x] 5.1 Update GitHub Sync to start policy-free Scoped Agent Sessions and cover configured non-Claude providers, writable review workspaces, normal local extensions, walkthrough submission, Review Threads, and follow-up conversation; verify the plugin's focused tests and typecheck pass
- [x] 5.2 Delete the Session Tool Policy module, policy-hook entry point, restricted Claude command builder and PTY adapter, private restricted settings, macOS agent sandbox profile, provider-state sandbox allowances, and obsolete tests; verify no production or documentation reference to `review-read-only`, `toolPolicy`, `--restricted`, or `spawn_scoped_claude_pty` remains
- [x] 5.3 Update `CONTEXT.md` and plugin authoring documentation to describe Project-selected normal providers, writable Scoped Workspaces, ordinary local authority, and separately scope-bound OpenForge credentials; verify documentation examples compile through the authoring contract fixture

## 6. Cross-boundary verification

- [x] 6.1 Run the focused Rust tests for scoped session service and storage, provider adapters, PTY command construction and exit handling, lifecycle hooks, agent ingress, credentials, migrations, HTTP routes, and plugin-host callbacks; verify every targeted suite passes before broad checks
- [x] 6.2 Run `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm plugin-host:typecheck`, `pnpm electron:contract:check`, and `pnpm build:plugin-sdk-runtime`; verify the affected desktop, renderer, Electron, and packaged plugin-host boundaries pass
- [x] 6.3 Run the Plugin SDK test, build, and contract checks plus the GitHub Sync test, typecheck, and production build scripts; verify both workspace packages pass their complete static and behavioral validation
- [x] 6.4 From the Backend Crate root returned by `node scripts/rust-sidecar-layout.mjs backend-crate-root`, run `cargo fmt --check`, `cargo test`, `cargo check`, `cargo build`, and `cargo clippy`; verify the full Backend Crate passes because database, provider, credential, concurrency, lifecycle, and process launch boundaries changed
- [x] 6.5 Run `openspec validate use-normal-scoped-agent-sessions --strict` and confirm `add-scoped-agent-sessions` and `share-agent-auth-with-scoped-sessions` have landed and synced before archive; verify no durable or active requirement still promises a read-only Scoped Agent Session
