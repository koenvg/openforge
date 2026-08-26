# Terminal Session Service migration

Agent terminals and regular Terminal plugin shells now use one host-owned `TerminalSessionService` in `src/lib/terminalSessionService.ts`. The service owns the sole production `TerminalRuntime`. Xterm remains the only production `TerminalView` implementation.

The migration keeps two thin compatibility facades:

- `src/lib/terminalPool.ts` presents the existing agent-terminal API through an owner-scoped client.
- `plugins/terminal/src/lib/terminalPool.ts` presents the existing built-in plugin API through a host-injected, owner-scoped client.

These facades do not own registries, choose renderers, read PTY buffers, or subscribe to PTY events. Owner scoping prevents plugin deactivation from disposing agent terminals. Attachment generations prevent an old surface cleanup from detaching a newer view.

## Stages

1. **Shared ownership, complete.** Route both existing UI paths through the host service while preserving their component APIs. Run the shared client contract against agent and regular plugin clients.
2. **Consumer cleanup.** Move core callers from the compatibility facade names to explicit Terminal Session clients where that improves ownership clarity. Remove the old `liveTerminalPool` naming after all callers use the regular-terminal client directly.
3. **Facade removal.** Delete a compatibility facade only after no production component, plugin bundle, or test imports it. This is source cleanup, not another lifecycle migration.

Each stage keeps Shell Session Keys and PTY instance checks unchanged. No stage adds terminal lifecycle or Electron details to the plugin SDK. A rollback can restore a consumer to its compatibility facade without restoring a second runtime or registry.
