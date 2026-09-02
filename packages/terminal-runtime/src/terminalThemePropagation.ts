import type { TerminalSessionCoordinator } from './terminalSessionCoordinator'
import type { TerminalThemeSnapshot } from './theme'

export function applyTerminalTheme(
  coordinators: Iterable<TerminalSessionCoordinator>,
  snapshot: TerminalThemeSnapshot,
): void {
  for (const coordinator of coordinators) coordinator.setTheme(snapshot.terminalTheme)
}
