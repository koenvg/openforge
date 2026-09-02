import { describe, expect, it, vi } from 'vitest'
import type { TerminalSessionCoordinator } from './terminalSessionCoordinator'
import { applyTerminalTheme } from './terminalThemePropagation'
import type { TerminalThemeSnapshot } from './theme'
function createCoordinator(): TerminalSessionCoordinator {
  return { setTheme: vi.fn() } as unknown as TerminalSessionCoordinator
}

describe('terminal theme propagation', () => {
  it('updates every coordinated terminal view with the selected terminal presentation', () => {
    const first = createCoordinator()
    const second = createCoordinator()
    const snapshot: TerminalThemeSnapshot = {
      appearance: 'dark',
      terminalTheme: {
        background: '#010101', foreground: '#fefefe', cursor: '#00ff00', cursorAccent: '#010101',
        selectionBackground: '#112233', selectionForeground: '#ffffff',
        black: '#111111', red: '#aa0000', green: '#00aa00', yellow: '#aaaa00',
        blue: '#0000aa', magenta: '#aa00aa', cyan: '#00aaaa', white: '#aaaaaa',
        brightBlack: '#555555', brightRed: '#ff5555', brightGreen: '#55ff55', brightYellow: '#ffff55',
        brightBlue: '#5555ff', brightMagenta: '#ff55ff', brightCyan: '#55ffff', brightWhite: '#ffffff',
      },
    }

    applyTerminalTheme([first, second], snapshot)

    expect(first.setTheme).toHaveBeenCalledWith(snapshot.terminalTheme)
    expect(second.setTheme).toHaveBeenCalledWith(snapshot.terminalTheme)
  })
})
