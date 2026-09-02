import type { TerminalSessionCoordinator } from './terminalSessionCoordinator'

export function applyTerminalFontSize(
  coordinators: Iterable<TerminalSessionCoordinator>,
  fontSize: number,
): void {
  for (const coordinator of coordinators) coordinator.setFontSize(fontSize)
}
