const TASK_PANE_SHORTCUTS = ['⌘3', '⌘4', '⌘5', '⌘6', '⌘7', '⌘8', '⌘9', '⌘0'] as const

export function getTaskPaneShortcut(tabIndex: number): string | null {
  return TASK_PANE_SHORTCUTS[tabIndex] ?? null
}
