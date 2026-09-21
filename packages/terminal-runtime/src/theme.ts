import { derived, writable, type Readable } from 'svelte/store'
import type { TerminalViewTheme } from './terminalView'

export type ThemeMode = 'light' | 'dark'
export type TerminalThemePalette = Readonly<Required<TerminalViewTheme>>

export interface TerminalRgbColor {
  readonly red: number
  readonly green: number
  readonly blue: number
}

export interface TerminalColorProfile {
  readonly version: 1
  readonly background: TerminalRgbColor
  readonly foreground: TerminalRgbColor
  readonly cursor: TerminalRgbColor
  readonly ansiColors: readonly TerminalRgbColor[]
}

export interface TerminalThemeSnapshot {
  readonly appearance: ThemeMode
  readonly terminalTheme: TerminalThemePalette
  readonly colorProfile: TerminalColorProfile
}

const ANSI_THEME_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
  'brightMagenta', 'brightCyan', 'brightWhite',
] as const satisfies readonly (keyof TerminalThemePalette)[]

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
    colorProfile: profile(TERMINAL_THEME_FALLBACKS.light),
  }),
  dark: Object.freeze({
    appearance: 'dark',
    terminalTheme: Object.freeze({ ...TERMINAL_THEME_FALLBACKS.dark }),
    colorProfile: profile(TERMINAL_THEME_FALLBACKS.dark),
  }),
})

function profile(theme: TerminalThemePalette): TerminalColorProfile {
  return Object.freeze({
    version: 1,
    background: rgb(theme.background),
    foreground: rgb(theme.foreground),
    cursor: rgb(theme.cursor),
    ansiColors: Object.freeze(ANSI_THEME_KEYS.map(name => rgb(theme[name]))),
  })
}

/**
 * Makes the published RGB profile authoritative for every core colour xterm
 * renders. Selection and cursor-accent colours remain renderer-only tokens.
 */
export function getTerminalViewTheme(snapshot: TerminalThemeSnapshot): TerminalThemePalette {
  if (snapshot.colorProfile.ansiColors.length < ANSI_THEME_KEYS.length) {
    throw new Error('terminal colour profile must define the 16 core ANSI colours')
  }
  return Object.freeze({
    ...snapshot.terminalTheme,
    background: hex(snapshot.colorProfile.background),
    foreground: hex(snapshot.colorProfile.foreground),
    cursor: hex(snapshot.colorProfile.cursor),
    ...Object.fromEntries(ANSI_THEME_KEYS.map((key, index) => [
      key,
      hex(snapshot.colorProfile.ansiColors[index]),
    ])),
  }) as TerminalThemePalette
}

function rgb(value: string): TerminalRgbColor {
  const match = /^#([0-9a-f]{6})$/i.exec(value)
  if (!match) throw new Error(`terminal fallback colour must be six-digit hex: ${value}`)
  const number = Number.parseInt(match[1], 16)
  return Object.freeze({
    red: number >> 16,
    green: (number >> 8) & 0xFF,
    blue: number & 0xFF,
  })
}

function hex(color: TerminalRgbColor): string {
  const channel = (value: number) => value.toString(16).padStart(2, '0').toUpperCase()
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`
}

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
