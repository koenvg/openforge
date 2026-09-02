import type {
  TerminalThemePalette,
  TerminalThemeSnapshot,
} from '@openforge-app/terminal-runtime'
import type { ThemeDefinition } from './themeContract'

export function createTerminalThemeSnapshot(
  theme: Pick<ThemeDefinition, 'appearance' | 'tokens'>,
): TerminalThemeSnapshot {
  const tokens = theme.tokens
  const terminalTheme: TerminalThemePalette = Object.freeze({
    background: tokens.terminalBackground,
    foreground: tokens.terminalForeground,
    cursor: tokens.terminalCursor,
    cursorAccent: tokens.terminalCursorAccent,
    selectionBackground: tokens.terminalSelectionBackground,
    selectionForeground: tokens.terminalSelectionForeground,
    black: tokens.terminalBlack,
    red: tokens.terminalRed,
    green: tokens.terminalGreen,
    yellow: tokens.terminalYellow,
    blue: tokens.terminalBlue,
    magenta: tokens.terminalMagenta,
    cyan: tokens.terminalCyan,
    white: tokens.terminalWhite,
    brightBlack: tokens.terminalBrightBlack,
    brightRed: tokens.terminalBrightRed,
    brightGreen: tokens.terminalBrightGreen,
    brightYellow: tokens.terminalBrightYellow,
    brightBlue: tokens.terminalBrightBlue,
    brightMagenta: tokens.terminalBrightMagenta,
    brightCyan: tokens.terminalBrightCyan,
    brightWhite: tokens.terminalBrightWhite,
  })

  return Object.freeze({
    appearance: theme.appearance,
    terminalTheme,
  })
}
