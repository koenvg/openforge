import { describe, expect, it } from 'vitest'
import { createTaskTerminalTabsSessionStore } from './taskTerminalTabsSession'

describe('task terminal tabs session store', () => {
  it('creates and retains the default shell session for each Task', () => {
    const store = createTaskTerminalTabsSessionStore()

    const first = store.get('T-1')

    expect(first).toEqual({
      tabs: [{ index: 0, key: 'T-1-shell-0', label: 'Shell 1' }],
      activeTabIndex: 0,
      nextIndex: 1,
    })
    expect(store.get('T-1')).toBe(first)
    expect(store.get('T-2')).not.toBe(first)
  })

  it('updates and clears Task-owned session state', () => {
    const store = createTaskTerminalTabsSessionStore()
    const updated = {
      tabs: [{ index: 3, key: 'T-1-shell-3', label: 'Shell 4' }],
      activeTabIndex: 3,
      nextIndex: 4,
    }

    store.update('T-1', updated)
    expect(store.get('T-1')).toBe(updated)

    store.clear('T-1')
    expect(store.get('T-1')).not.toBe(updated)
  })
})
