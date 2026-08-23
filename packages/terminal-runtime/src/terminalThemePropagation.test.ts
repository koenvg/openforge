import { describe, expect, it, vi } from 'vitest'
import { applyTerminalTheme } from './terminalThemePropagation'
import type { PoolEntry } from './terminalRuntimeTypes'

vi.mock('./theme', () => ({
  getTerminalTheme: vi.fn((mode: string) => ({ background: mode })),
}))

describe('terminal theme propagation', () => {
  it('updates every pooled terminal with the resolved theme', () => {
    const first = { terminal: { options: {} } } as PoolEntry
    const second = { terminal: { options: {} } } as PoolEntry

    applyTerminalTheme([first, second], 'dark')

    expect(first.terminal.options.theme).toEqual({ background: 'dark' })
    expect(second.terminal.options.theme).toEqual({ background: 'dark' })
  })
})
