// The task-view terminal tab is contributed by the built-in terminal plugin
// (`plugins/terminal/src/`), which instantiates its OWN `createTerminalRuntime`
// — a separate pool, tab-session map, and shell-lifecycle state from the
// app-local `src/lib/terminalPool`. Any core code that needs to observe or drive
// the terminal the user actually sees (e.g. the "Run app" button) must read from
// that plugin runtime, not the app pool. This bridge is the single, documented
// seam for reaching the live terminal runtime from core.
//
// This works because the terminal plugin is a SOURCE-linked builtin: builtinPluginModules
// statically imports `plugins/terminal/src/index`, so the plugin's components and this
// re-export resolve to the same `plugins/terminal/src/lib/terminalPool` module — i.e. one
// `createTerminalRuntime` singleton. If the terminal plugin is ever migrated to dist/manifest
// loading, the live terminal would use the dist singleton and this bridge would point at a
// different instance — re-run/adjust `liveTerminalPool.test.ts` and repoint this bridge then.
export {
  getShellLifecycleState,
  getTaskTerminalTabsSession,
} from '../../plugins/terminal/src/lib/terminalPool'
