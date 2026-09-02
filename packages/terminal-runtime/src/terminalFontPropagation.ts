import type { TerminalSessionCoordinator } from './terminalSessionCoordinator'

export function applyTerminalFont(
  coordinators: Iterable<TerminalSessionCoordinator>,
  fontFamily: string,
): void {
  for (const coordinator of coordinators) coordinator.setFontFamily(fontFamily)
}
