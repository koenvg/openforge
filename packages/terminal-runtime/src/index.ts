export {
  APP_EVENTS_RECONNECTED_EVENT,
  createTerminalRuntime,
  type PoolEntry,
  type PtyEvent,
  type ShellLifecycleState,
  type TaskTerminalTabsSession,
  type TerminalRuntime,
  type TerminalRuntimeEvent,
  type TerminalRuntimeHost,
  type TerminalRuntimeUnlistenFn,
  type TerminalTab,
} from './terminalRuntime'
export {
  TERMINAL_CELL_HEIGHT,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_WEB_FONT_FACES,
  getTerminalOptions,
  preloadTerminalFonts,
} from './terminalOptions'
export {
  getDiffTheme,
  getTerminalTheme,
  setupHostThemeSync,
  syncThemeModeWithDocument,
  themeMode,
  type ThemeMode,
} from './theme'
export {
  handleTerminalShortcutKeydown,
  type TerminalShortcutController,
} from './terminalShortcuts'
export {
  createTerminalShortcutController,
  isTerminalShortcutScopeVisible,
  type TerminalShortcutControllerOptions,
  type TerminalShortcutControllerWiring,
  type TerminalShortcutKeydownTarget,
  type TerminalTabsShortcutTarget,
} from './terminalShortcutController'
export {
  createLoadingTerminalTaskPaneWorkspaceSnapshot,
  createRejectedTerminalTaskPaneWorkspaceSnapshot,
  createResolvedTerminalTaskPaneWorkspaceSnapshot,
  createTerminalTaskPaneWorkspaceLookupController,
  formatTerminalTaskPaneWorkspaceLookupError,
  getTerminalTaskPaneWorkspaceStatusText,
  type TerminalTaskPaneTaskSwitch,
  type TerminalTaskPaneWorkspaceLookupController,
  type TerminalTaskPaneWorkspaceLookupRequest,
  type TerminalTaskPaneWorkspaceLookupState,
  type TerminalTaskPaneWorkspaceResult,
  type TerminalTaskPaneWorkspaceSnapshot,
} from './taskPaneWorkspaceLookup'
