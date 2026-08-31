import { getTerminalTheme, type ThemeMode } from './theme'
import type { TerminalSessionCoordinator } from './terminalSessionCoordinator'

export function applyTerminalTheme(
  coordinators: Iterable<TerminalSessionCoordinator>,
  mode: ThemeMode,
): void {
  const theme = getTerminalTheme(mode)
  for (const coordinator of coordinators) coordinator.setTheme(theme)
}
