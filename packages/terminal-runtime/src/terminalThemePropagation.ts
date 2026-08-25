import { getTerminalTheme, type ThemeMode } from './theme'
import type { PoolEntry } from './terminalRuntimeTypes'

export function applyTerminalTheme(entries: Iterable<PoolEntry>, mode: ThemeMode): void {
  const theme = getTerminalTheme(mode)
  for (const entry of entries) entry.view.setTheme(theme)
}
