## Why

Updating or restarting OpenForge currently stops its Rust Sidecar and live PTYs, then launches replacement agents from stored conversation history. Users need the same agent processes and in-progress tools to keep running while OpenForge, its Sidecar, and its terminal host update, with their selected Task and terminal tabs restored afterward.

## What Changes

- Extract live PTY ownership, process supervision, terminal recovery state, and ordered output into a separate Session Daemon. Keep Task data, SQLite, provider orchestration, and plugin business logic in the Rust Sidecar.
- Preserve live agent and indexed shell sessions during explicit app restarts and coordinated updates. Normal Quit still terminates sessions; losing a connection is not itself a Quit request.
- Replace Electron and the Rust Sidecar immediately. Investigate in-place Session Daemon executable replacement first so updating the daemon does not have to wait for live sessions to end. Make a macOS feasibility and failure-recovery spike a blocking implementation gate rather than promising an unproven mechanism.
- Keep agent-facing endpoints discoverable across backend replacement, retain accepted lifecycle notifications, and return explicit retryable responses for unavailable commands without silently replaying mutations.
- Persist and restore project, Task, current view, terminal tab identities, labels, order, and active selection. Reattach to live sessions instead of spawning replacements.
- Add compatibility preflight, exclusive controller ownership, restart recovery, and bounded terminal/event recovery. Unsupported transitions must refuse the update without stopping sessions.
- Route supported update/install and explicit restart entry points through this protocol. Do not broaden this change into release discovery, a new update feed, or new release channels.
- **BREAKING internal lifecycle change:** Electron and the Sidecar no longer exclusively own the lifetime of PTYs. Installers, process cleanup, desktop test ownership, and shutdown contracts must distinguish replacement from normal Quit. Preserve public plugin and renderer terminal operations where possible.

## Capabilities

### New Capabilities

- `persistent-session-daemon`: Independent PTY hosting, authenticated ownership, live inventory, ordered recovery, stable agent ingress, and compatible live daemon replacement.
- `session-preserving-restart`: Explicit update/restart transactions that replace app processes without replacing agent processes, with normal-Quit semantics, compatibility gates, and recovery.
- `restart-workspace-restoration`: Durable navigation and terminal tab restoration reconciled against live session identity.

### Modified Capabilities

- `terminal-session-coordination`: Extend terminal coordination to reattach after host replacement, preserve PTY identity across controller generations, and reject stale controller work without treating transport loss as process exit.

## Impact

- Rust backend: `src-tauri/src/pty_manager/`, terminal model/replay support, providers, `startup_resume.rs`, HTTP ingress, Sidecar shutdown, plugin shell callbacks, and Companion terminal consumers. Introduces a Rust Session Daemon executable and a versioned local protocol/client.
- Electron: `src/electron/bootLifecycle.ts`, `sidecar.ts`, `shutdown.ts`, event forwarding, runtime discovery, and restart orchestration.
- Renderer and terminal package: typed IPC wrappers, `src/lib/terminalSessionService.ts`, routing/stores, and `packages/terminal-runtime/` attachment and tab coordination. Renderer selection is not being redesigned.
- Distribution and developer tooling: daemon packaging outside replaceable bundle resources while live, CLI discovery/refresh, `scripts/install-electron-mac.sh`, and isolated desktop lifecycle tests. Trusted artifact verification remains mandatory; arbitrary manual bundle replacement is not a supported handoff.
- Validation spans the desktop renderer/Electron subsystem, affected workspace packages/plugins, Rust crates, transport contracts, and isolated packaged macOS update tests on arm64 and x64. The first adoption from the existing non-daemon build requires a clearly disclosed session-interrupting restart; continuity applies to sessions launched under the new host.
