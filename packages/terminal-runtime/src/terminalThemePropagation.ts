import type { TerminalSessionCoordinator } from './terminalSessionCoordinator'
import { getTerminalViewTheme, type TerminalThemeSnapshot } from './theme'

export function applyTerminalTheme(
  coordinators: Iterable<TerminalSessionCoordinator>,
  snapshot: TerminalThemeSnapshot,
): void {
  const theme = getTerminalViewTheme(snapshot)
  for (const coordinator of coordinators) coordinator.setTheme(theme)
}
