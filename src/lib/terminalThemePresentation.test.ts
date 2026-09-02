import { describe, expect, it } from 'vitest'
import { DARK_THEME } from './themeContract'
import { createTerminalThemeSnapshot } from './terminalThemePresentation'

describe('terminal theme presentation adapter', () => {
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
    expect(snapshot.terminalTheme.foreground).toBe('#f1f2f3')
    expect(snapshot.terminalTheme.red).toBe('#c01122')
    expect(snapshot.terminalTheme.brightRed).toBe('#ff4455')
    expect(Object.keys(snapshot.terminalTheme)).toHaveLength(22)
  })
})
