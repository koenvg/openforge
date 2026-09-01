import { writable } from 'svelte/store'
import { TERMINAL_FONT_SIZE } from '@openforge-app/terminal-runtime'
import { getConfig, setConfig } from './ipc'

export const MIN_TERMINAL_FONT_SIZE = 9
export const MAX_TERMINAL_FONT_SIZE = 24

export const terminalFontSize = writable<number>(TERMINAL_FONT_SIZE)

function clampTerminalFontSize(size: number): number {
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, size))
}

function isValidStoredFontSize(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_TERMINAL_FONT_SIZE && value <= MAX_TERMINAL_FONT_SIZE
}

/**
 * Apply a terminal font size choice: updates the reactive store (which live-propagates
 * to every open terminal via terminalSessionService) and persists the preference.
 */
export function applyTerminalFontSizeChoice(size: number): void {
  const clamped = clampTerminalFontSize(size)
  terminalFontSize.set(clamped)
  setConfig('terminalFontSize', String(clamped)).catch((e) =>
    console.error('Failed to persist terminal font size:', e)
  )
}

/**
 * Load stored terminal font size preference from backend config and apply it.
 * Falls back to the default size if no preference is stored or on error.
 */
export async function initTerminalFontSizeChoice(): Promise<void> {
  let size = TERMINAL_FONT_SIZE
  try {
    const stored = await getConfig('terminalFontSize')
    if (stored !== null) {
      const parsed = Number(stored)
      if (isValidStoredFontSize(parsed)) {
        size = parsed
      }
    }
  } catch {
    // fallthrough: use default size
  }
  terminalFontSize.set(size)
}
