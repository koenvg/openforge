import { describe, expect, it } from 'vitest'
import { BUILTIN_THEMES, DARK_THEME } from './themeContract'
import {
  createTerminalThemeSnapshot,
  resolveTerminalThemeSnapshot,
  TerminalThemeResolutionError,
} from './terminalThemePresentation'

describe('terminal theme presentation adapter', () => {
  it.each(BUILTIN_THEMES)('presents $label without prescribing a terminal font', (theme) => {
    const snapshot = createTerminalThemeSnapshot(theme)
    expect(snapshot.appearance).toBe(theme.appearance)
    expect(snapshot.terminalTheme).toMatchObject({
      background: theme.tokens.terminalBackground, foreground: theme.tokens.terminalForeground,
      cursor: theme.tokens.terminalCursor, cursorAccent: theme.tokens.terminalCursorAccent,
      selectionBackground: theme.tokens.terminalSelectionBackground, selectionForeground: theme.tokens.terminalSelectionForeground,
      red: theme.tokens.terminalRed, green: theme.tokens.terminalGreen,
      blue: theme.tokens.terminalBlue, yellow: theme.tokens.terminalYellow,
    })
    expect(Object.keys(snapshot.terminalTheme)).toHaveLength(22)
    expect(snapshot.colorProfile).toEqual({
      version: 1,
      background: rgb(theme.tokens.terminalBackground),
      foreground: rgb(theme.tokens.terminalForeground),
      cursor: rgb(theme.tokens.terminalCursor),
      ansiColors: [
        theme.tokens.terminalBlack,
        theme.tokens.terminalRed,
        theme.tokens.terminalGreen,
        theme.tokens.terminalYellow,
        theme.tokens.terminalBlue,
        theme.tokens.terminalMagenta,
        theme.tokens.terminalCyan,
        theme.tokens.terminalWhite,
        theme.tokens.terminalBrightBlack,
        theme.tokens.terminalBrightRed,
        theme.tokens.terminalBrightGreen,
        theme.tokens.terminalBrightYellow,
        theme.tokens.terminalBrightBlue,
        theme.tokens.terminalBrightMagenta,
        theme.tokens.terminalBrightCyan,
        theme.tokens.terminalBrightWhite,
      ].map(rgb),
    })
    expect(snapshot).not.toHaveProperty('fontFamily')
    expect(snapshot.terminalTheme).not.toHaveProperty('fontFamily')
  })

  it('maps explicit appearance and every selected terminal token without inspecting the theme id', () => {
    const theme = {
      ...DARK_THEME,
      id: 'vendor:midnight',
      appearance: 'dark' as const,
      tokens: {
        ...DARK_THEME.tokens,
        terminalBackground: '#010203',
        terminalForeground: '#f1f2f3',
        terminalRed: '#c01122',
        terminalBrightRed: '#ff4455',
      },
    }

    const snapshot = createTerminalThemeSnapshot(theme)

    expect(snapshot.appearance).toBe('dark')
    expect(snapshot.terminalTheme.background).toBe('#010203')
    expect(snapshot.terminalTheme.foreground).toBe('#F1F2F3')
    expect(snapshot.terminalTheme.red).toBe('#C01122')
    expect(snapshot.terminalTheme.brightRed).toBe('#FF4455')
    expect(Object.keys(snapshot.terminalTheme)).toHaveLength(22)
  })

  it('resolves contributed CSS colours and composites alpha against the terminal background', () => {
    const theme = {
      ...DARK_THEME,
      tokens: {
        ...DARK_THEME.tokens,
        canvas: 'var(--canvas)',
        terminalBackground: 'color-mix(in srgb, black 50%, white)',
        terminalForeground: 'rgb(255 255 255 / 50%)',
      },
    }
    const colours = new Map([
      ['var(--canvas)', { red: 32, green: 32, blue: 32, alpha: 1 }],
      ['color-mix(in srgb, black 50%, white)', { red: 128, green: 128, blue: 128, alpha: 0.5 }],
      ['rgb(255 255 255 / 50%)', { red: 255, green: 255, blue: 255, alpha: 0.5 }],
    ])
    const resolveColor = (value: string) => colours.get(value) ?? rgba(value)

    const snapshot = resolveTerminalThemeSnapshot(theme, resolveColor)

    expect(snapshot.colorProfile.background).toEqual({ red: 80, green: 80, blue: 80 })
    expect(snapshot.colorProfile.foreground).toEqual({ red: 168, green: 168, blue: 168 })
    expect(snapshot.terminalTheme.background).toBe('#505050')
    expect(snapshot.terminalTheme.foreground).toBe('#A8A8A8')
  })

  it('rejects an incomplete resolved profile and the compatibility adapter falls back to OpenForge Light', () => {
    const broken = {
      ...DARK_THEME,
      tokens: { ...DARK_THEME.tokens, terminalRed: 'var(--missing)' },
    }
    const resolveColor = (value: string) => value === 'var(--missing)' ? null : rgba(value)

    expect(() => resolveTerminalThemeSnapshot(broken, resolveColor))
      .toThrow(TerminalThemeResolutionError)

    const fallback = createTerminalThemeSnapshot(broken, resolveColor)
    const light = createTerminalThemeSnapshot(BUILTIN_THEMES[0], resolveColor)
    expect(fallback).toEqual(light)
  })
})

function rgba(value: string): { red: number; green: number; blue: number; alpha: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value)
  if (!match) return null
  const number = Number.parseInt(match[1], 16)
  return {
    red: number >> 16,
    green: (number >> 8) & 0xFF,
    blue: number & 0xFF,
    alpha: 1,
  }
}

function rgb(value: string): { red: number; green: number; blue: number } {
  const resolved = rgba(value)
  if (!resolved) throw new Error(`expected hex colour, received ${value}`)
  return { red: resolved.red, green: resolved.green, blue: resolved.blue }
}
