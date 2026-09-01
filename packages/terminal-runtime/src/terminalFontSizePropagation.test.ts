import { describe, expect, it, vi } from 'vitest'
import type { TerminalSessionCoordinator } from './terminalSessionCoordinator'
import { applyTerminalFontSize } from './terminalFontSizePropagation'

function createCoordinator(): TerminalSessionCoordinator {
  return { setFontSize: vi.fn() } as unknown as TerminalSessionCoordinator
}

describe('terminal font size propagation', () => {
  it('updates every coordinated terminal view with the resolved font size', () => {
    const first = createCoordinator()
    const second = createCoordinator()

    applyTerminalFontSize([first, second], 16)

    expect(first.setFontSize).toHaveBeenCalledWith(16)
    expect(second.setFontSize).toHaveBeenCalledWith(16)
  })
})
