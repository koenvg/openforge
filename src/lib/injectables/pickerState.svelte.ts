import type { Injectable } from '../types'

/**
 * App-wide state for the summonable Injectable Picker. Surfaces (Create Task dialog,
 * live session) call openPicker with the active project and an onInsert callback that
 * knows where the selected text should go. handleSelect routes the chosen injectable's
 * invocation text back to that callback and closes.
 */
function createPickerState() {
  let open = $state(false)
  let projectId = $state<string | null>(null)
  let onInsert: ((text: string) => void) | null = null

  return {
    get open() {
      return open
    },
    get projectId() {
      return projectId
    },
    openPicker(ctx: { projectId: string | null; onInsert: (text: string) => void }) {
      projectId = ctx.projectId
      onInsert = ctx.onInsert
      open = true
    },
    close() {
      open = false
      onInsert = null
    },
    handleSelect(injectable: Injectable) {
      onInsert?.(injectable.invocationText)
      open = false
      onInsert = null
    },
  }
}

export const pickerState = createPickerState()
