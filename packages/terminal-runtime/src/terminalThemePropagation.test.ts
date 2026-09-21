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
      colorProfile: {
        version: 1,
        background: { red: 1, green: 2, blue: 3 },
        foreground: { red: 254, green: 253, blue: 252 },
        cursor: { red: 4, green: 5, blue: 6 },
        ansiColors: Array.from({ length: 16 }, (_, index) => ({
          red: index,
          green: index + 16,
          blue: index + 32,
        })),
      },
    }

    applyTerminalTheme([first, second], snapshot)

    const applied = vi.mocked(first.setTheme).mock.calls[0][0]
    expect(second.setTheme).toHaveBeenCalledWith(applied)
    expect(applied).toMatchObject({
      background: '#010203',
      foreground: '#FEFDFC',
      cursor: '#040506',
      black: '#001020',
      red: '#011121',
      brightWhite: '#0F1F2F',
      selectionBackground: '#112233',
    })
  })
})
