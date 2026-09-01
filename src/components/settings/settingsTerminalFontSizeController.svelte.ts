import { fromStore } from 'svelte/store'
import { applyTerminalFontSizeChoice, terminalFontSize } from '../../lib/terminalFontSize'

export function createSettingsTerminalFontSizeController() {
  const terminalFontSizeState = fromStore(terminalFontSize)
  let selected = $state(terminalFontSizeState.current)

  $effect(() => {
    selected = terminalFontSizeState.current
  })

  function select(size: number): void {
    applyTerminalFontSizeChoice(size)
  }

  return {
    get selected() { return selected },
    select,
  }
}

export type SettingsTerminalFontSizeController = ReturnType<typeof createSettingsTerminalFontSizeController>
