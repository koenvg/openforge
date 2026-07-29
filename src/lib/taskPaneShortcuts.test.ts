import { describe, expect, it } from 'vitest'

import { getTaskPaneShortcut } from './taskPaneShortcuts'

describe('getTaskPaneShortcut', () => {
  it('assigns plugin task-pane tabs to the remaining command-number shortcuts', () => {
    expect(Array.from({ length: 8 }, (_, index) => getTaskPaneShortcut(index))).toEqual([
      '⌘3',
      '⌘4',
      '⌘5',
      '⌘6',
      '⌘7',
      '⌘8',
      '⌘9',
      '⌘0',
    ])
  })

  it('does not assign shortcuts beyond the available number keys', () => {
    expect(getTaskPaneShortcut(8)).toBeNull()
  })
})
