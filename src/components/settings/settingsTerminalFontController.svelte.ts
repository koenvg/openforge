import { fromStore } from 'svelte/store'
import { applyTerminalFontChoice, terminalFont } from '../../lib/terminalFont'
import type { TerminalFontId } from '../../lib/terminalFont'

export function createSettingsTerminalFontController() {
  const terminalFontState = fromStore(terminalFont)
  let selected = $state(terminalFontState.current)

  $effect(() => {
    selected = terminalFontState.current
  })

  function select(font: TerminalFontId): void {
    applyTerminalFontChoice(font)
  }

  return {
    get selected() { return selected },
    select,
  }
}

export type SettingsTerminalFontController = ReturnType<typeof createSettingsTerminalFontController>
