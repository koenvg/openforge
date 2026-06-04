# ADR 0004: Keep terminal UI policy in the terminal plugin and expose generic shell sessions

Status: Accepted
Date: 2026-06-04
Task: KVG-1334

OpenForge has a built-in terminal plugin, but the plugin had been depending on a private `@openforge/terminal-shared` package that re-exported host renderer components, IPC wrappers, desktop event listeners, and terminal pool internals. We will replace that leakage with a small SDK shell capability: plugins receive public **Shell Session** identity, typed output/exit events, spawn/write/resize/kill/buffer operations, and enough origin metadata to distinguish task, project, and plugin-defined sessions without learning app-internal PTY keys.

The terminal plugin keeps ownership of xterm UI, tab/session policy, terminal pool orchestration, keybindings, restart/exit presentation, and project-versus-task terminal behavior. Core remains responsible only for host-managed shell process transport, public session identity mapping, event forwarding, capability validation, and broad config/storage primitives that benefit plugins beyond terminals.

## Considered options

- Keep `@openforge/terminal-shared` as the sharing boundary. Rejected because it makes a built-in plugin depend on private host implementation details and prevents external plugins from proving the public SDK contract.
- Move terminal UI and lifecycle policy into OpenForge core. Rejected because terminal behavior is a plugin-owned domain and would bloat the SDK/core with terminal-specific tab and xterm policy.
- Expose raw task-derived PTY keys through the SDK. Rejected because task shell, project terminal, and arbitrary plugin sessions need clear public identity without coupling plugin authors to sidecar key/file naming conventions.

## Consequences

- SDK additions must stay generic: shell/session identity, typed shell events, active-view/keybinding routing where broadly useful, config/storage, and capability validation.
- Terminal-specific lifecycle truth belongs in the terminal plugin; core may translate public session IDs to host process keys but should not own terminal tab or pool state.
- Built-in terminal plugin tests must assert the absence of private `@openforge/terminal-shared` imports so the built-in remains a reference implementation for external plugin authors.
