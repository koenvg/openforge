# Terminal Session Service migration

Agent terminals and regular Terminal plugin shells now use one host-owned `TerminalSessionService` in `src/lib/terminalSessionService.ts`. The service owns the sole production `TerminalRuntime`. Xterm remains the only production `TerminalView` implementation.

Desktop callers now import `agentTerminalSessions` or `regularTerminalSessions` directly from `src/lib/terminalSessionService.ts`. The former desktop forwarding modules, `src/lib/terminalPool.ts` and `src/lib/liveTerminalPool.ts`, have been removed.

The built-in Terminal plugin keeps `plugins/terminal/src/lib/terminalPool.ts` as a package-local host-injection boundary. It cannot import the desktop composition root, and `src/lib/plugin/builtinPluginModules.ts` configures it with `regularTerminalSessions`. This plugin facade does not own a registry, choose a renderer, read PTY buffers, or subscribe to PTY events.

Owner scoping prevents plugin deactivation from disposing agent terminals. Attachment generations prevent an old surface cleanup from detaching a newer view.

## Stages

1. **Shared ownership, complete.** Route both existing UI paths through the host service while preserving their component APIs. Run the shared client contract against agent and regular plugin clients.
2. **Consumer cleanup, complete.** Core desktop callers use explicit owner-scoped clients, and regular Terminal Surfaces no longer use agent-terminal forwarding names.
3. **Desktop facade removal, complete.** No production component or test imports either deleted desktop module. The built-in plugin facade remains because it is the host-injected package boundary, not a desktop compatibility layer.

Each stage keeps Shell Session Keys and PTY instance checks unchanged. No stage adds terminal lifecycle or Electron details to the plugin SDK. A rollback can restore a consumer to its compatibility facade without restoring a second runtime or registry.
