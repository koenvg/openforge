import { describe, expect, it, vi } from 'vitest'
import { applyTerminalTheme } from './terminalThemePropagation'
import type { PoolEntry } from './terminalRuntimeTypes'

vi.mock('./theme', () => ({
  getTerminalTheme: vi.fn((mode: string) => ({ background: mode })),
}))

function createEntry(): PoolEntry {
  return { view: { setTheme: vi.fn() } } as unknown as PoolEntry
}

describe('terminal theme propagation', () => {
  it('updates every pooled terminal view with the resolved theme', () => {
    const first = createEntry()
    const second = createEntry()

    applyTerminalTheme([first, second], 'dark')

    expect(first.view.setTheme).toHaveBeenCalledWith({ background: 'dark' })
    expect(second.view.setTheme).toHaveBeenCalledWith({ background: 'dark' })
  })
})
