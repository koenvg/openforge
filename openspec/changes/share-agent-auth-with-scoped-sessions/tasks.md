## 1. Resolve and verify provider authentication

- [x] 1.1 Add failing Rust tests for one Claude launch-context resolver that preserves the normal Task agent's effective `HOME`, user-supplied `CLAUDE_CONFIG_DIR`, API and cloud-provider authentication environment, and executable path while removing Task-only OpenForge credentials; verify tests also prove that credential values never appear in debug output or errors
- [x] 1.2 Implement the launch-context resolver and a bounded Claude authentication probe that discards provider output and uses the exact resolved environment; verify authenticated, unauthenticated, missing-executable, timeout, and custom-configuration cases pass
- [x] 1.3 Add service tests for authentication checks before admission, queue promotion, completed-session continuation, and final process spawn, then wire readiness into the scoped runtime so unauthenticated work creates no provider process, workspace, or capacity reservation and returns `AUTHENTICATION_UNAVAILABLE`

## 2. Separate scoped runtime state from provider identity

- [x] 2.1 Add failing lifecycle-hook and adapter tests for `OPENFORGE_SCOPED_STATE_DIR`, then move the turn marker and temporary state to that directory and remove OpenForge's scoped `CLAUDE_CONFIG_DIR` override; verify new and resumed commands retain unique provider session IDs
- [x] 2.2 Add macOS sandbox tests for default and user-selected Claude state paths, canonicalization, symlink escape, unsafe broad roots, and workspace overlap, then allow writes only to resolved provider state and OpenForge scoped runtime state while every Scoped Workspace write remains denied
- [x] 2.3 Update the generated review policy and command snapshots to keep user and Project setting sources, plugins, slash commands, and MCP servers excluded; remove the obsolete `MultiEdit` deny rule and verify startup emits no unknown-tool warning without changing the closed tool allowlist
- [x] 2.4 Update release, failed-launch, and startup cleanup tests so OpenForge removes only scoped policy and lifecycle state; verify release leaves the shared provider login and unrelated provider conversations usable

## 3. Keep contracts and integrated behavior aligned

- [x] 3.1 Add `AUTHENTICATION_UNAVAILABLE` to Rust HTTP and plugin-host error mapping, public Plugin SDK error types, frontend parsing, CommonAPIFake, and packaged runtime fixtures; verify every boundary returns the same typed category and no credential data
- [x] 3.2 Build an authenticated fake-Claude integration fixture and prove a normal Task session and concurrent scoped sessions use the same auth context, skip login and first-run onboarding, keep distinct conversation IDs, and resume only their own conversations
- [x] 3.3 Extend the policy integration tests with permissive personal settings, personal hooks, plugins, slash commands, MCP servers, and simulated user approval; verify none become active and the checkout hash is unchanged after direct edit and shell-mutation attempts

## 4. Validate the affected systems

- [x] 4.1 Run the focused Rust tests for runtime checks, scoped session service and runtime, provider adapters, command building, policy hooks, sandbox profiles, HTTP error mapping, and plugin-host callbacks; verify all targeted tests pass before the full suites
- [x] 4.2 From the backend crate root returned by `node scripts/rust-sidecar-layout.mjs backend-crate-root`, run `cargo fmt --check`, `cargo test`, `cargo check`, `cargo build`, and `cargo clippy`; verify the full Backend Crate passes because authentication, sandboxing, concurrency, lifecycle, and process launch are shared boundaries
- [x] 4.3 Run `pnpm packages:test`, `pnpm packages:build`, `pnpm packages:contract:check`, `pnpm electron:contract:check`, `pnpm exec vitest run scripts/build-plugin-sdk-runtime.test.mjs`, the affected renderer and Electron host tests, `pnpm exec tsc --noEmit`, `pnpm plugin-host:typecheck`, and `pnpm lint`; verify SDK, packaged runtime, IPC, host mappings, and static checks agree on the new error contract
