import { describe, expect, it, vi } from 'vitest'
import type { TerminalSessionCoordinator } from './terminalSessionCoordinator'
import { applyTerminalTheme } from './terminalThemePropagation'

vi.mock('./theme', () => ({
  getTerminalTheme: vi.fn((mode: string) => ({ background: mode })),
}))

function createCoordinator(): TerminalSessionCoordinator {
  return { setTheme: vi.fn() } as unknown as TerminalSessionCoordinator
}

describe('terminal theme propagation', () => {
  it('updates every coordinated terminal view with the resolved theme', () => {
    const first = createCoordinator()
    const second = createCoordinator()

    applyTerminalTheme([first, second], 'dark')

    expect(first.setTheme).toHaveBeenCalledWith({ background: 'dark' })
    expect(second.setTheme).toHaveBeenCalledWith({ background: 'dark' })
  })
})
