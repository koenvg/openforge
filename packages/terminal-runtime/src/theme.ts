import { derived, writable, type Readable } from 'svelte/store'
import type { TerminalViewTheme } from './terminalView'

export type ThemeMode = 'light' | 'dark'
export type TerminalThemePalette = Readonly<Required<TerminalViewTheme>>

export interface TerminalThemeSnapshot {
  readonly appearance: ThemeMode
  readonly terminalTheme: TerminalThemePalette
}

const TERMINAL_THEME_FALLBACKS = {
  light: {
    background: '#FFFFFF',
    foreground: '#1F2328',
    cursor: '#0969DA',
    cursorAccent: '#FFFFFF',
    selectionBackground: '#0969DA33',
    selectionForeground: '#1F2328',
    black: '#24292F',
    red: '#CF222E',
    green: '#116329',
    yellow: '#4D2D00',
    blue: '#0969DA',
    magenta: '#8250DF',
    cyan: '#1B7C83',
    white: '#6E7781',
    brightBlack: '#57606A',
    brightRed: '#A40E26',
    brightGreen: '#1A7F37',
    brightYellow: '#633C01',
    brightBlue: '#218BFF',
    brightMagenta: '#A475F9',
    brightCyan: '#3192AA',
    brightWhite: '#8C959F',
  },
  dark: {
    background: '#1C1A1F',
    foreground: '#D8D4DE',
    cursor: '#D8D4DE',
    cursorAccent: '#1C1A1F',
    selectionBackground: '#2E2A34',
    selectionForeground: '#D8D4DE',
    black: '#454250',
    red: '#F87171',
    green: '#66BB6A',
    yellow: '#FACC15',
    blue: '#8B82E0',
    magenta: '#C084FC',
    cyan: '#22D3EE',
    white: '#D8D4DE',
    brightBlack: '#9A98AE',
    brightRed: '#FCA5A5',
    brightGreen: '#81C784',
    brightYellow: '#FDE68A',
    brightBlue: '#A9A0F0',
    brightMagenta: '#D8B4FE',
    brightCyan: '#67E8F9',
    brightWhite: '#E8E4EE',
  },
} as const satisfies Record<ThemeMode, TerminalThemePalette>

const TERMINAL_THEME_SNAPSHOTS: Readonly<Record<ThemeMode, TerminalThemeSnapshot>> = Object.freeze({
  light: Object.freeze({
    appearance: 'light',
    terminalTheme: Object.freeze({ ...TERMINAL_THEME_FALLBACKS.light }),
  }),
  dark: Object.freeze({
    appearance: 'dark',
    terminalTheme: Object.freeze({ ...TERMINAL_THEME_FALLBACKS.dark }),
  }),
})

export function getTerminalThemeSnapshot(appearance: ThemeMode): TerminalThemeSnapshot {
  return TERMINAL_THEME_SNAPSHOTS[appearance]
}

/** Compatibility helper for standalone consumers that only select light or dark. */
export function getTerminalTheme(appearance: ThemeMode): TerminalViewTheme {
  return getTerminalThemeSnapshot(appearance).terminalTheme
}

export const themeMode = writable<ThemeMode>('light')
export const themePresentation: Readable<TerminalThemeSnapshot> = derived(
  themeMode,
  getTerminalThemeSnapshot,
)
