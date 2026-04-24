import type { ITheme } from '@xterm/xterm'
import { writable } from 'svelte/store'
import { getConfig, setConfig } from './ipc'

export type ThemeMode = 'light' | 'dark'

export const themeMode = writable<ThemeMode>('light')

const THEME_NAMES: Record<ThemeMode, string> = {
  light: 'openforge',
  dark: 'openforge-dark',
}

/**
 * Apply a theme mode: sets the data-theme attribute on <html>,
 * updates the reactive store, and persists the preference.
 */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', THEME_NAMES[mode])
  themeMode.set(mode)
  setConfig('theme', mode).catch((e) =>
    console.error('Failed to persist theme:', e)
  )
}

/**
 * Load stored theme preference from backend config and apply it.
 * Falls back to light mode if no preference is stored or on error.
 */
export async function initTheme(): Promise<void> {
  let mode: ThemeMode = 'light'
  try {
    const stored = await getConfig('theme')
    if (stored === 'dark') {
      mode = 'dark'
    }
  } catch {
    // fallthrough: use default light mode
  }
  document.documentElement.setAttribute('data-theme', THEME_NAMES[mode])
  themeMode.set(mode)
}

type TerminalThemeKey =
  | 'background'
  | 'foreground'
  | 'cursor'
  | 'cursorAccent'
  | 'selectionBackground'
  | 'selectionForeground'
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite'

const TERMINAL_THEME_VARIABLES = {
  background: '--term-background',
  foreground: '--term-foreground',
  cursor: '--term-cursor',
  cursorAccent: '--term-cursor-accent',
  selectionBackground: '--term-selection-background',
  selectionForeground: '--term-selection-foreground',
  black: '--term-black',
  red: '--term-red',
  green: '--term-green',
  yellow: '--term-yellow',
  blue: '--term-blue',
  magenta: '--term-magenta',
  cyan: '--term-cyan',
  white: '--term-white',
  brightBlack: '--term-bright-black',
  brightRed: '--term-bright-red',
  brightGreen: '--term-bright-green',
  brightYellow: '--term-bright-yellow',
  brightBlue: '--term-bright-blue',
  brightMagenta: '--term-bright-magenta',
  brightCyan: '--term-bright-cyan',
  brightWhite: '--term-bright-white',
} as const satisfies Record<TerminalThemeKey, string>

const TERMINAL_THEME_FALLBACKS: Record<ThemeMode, Record<TerminalThemeKey, string>> = {
  light: {
    background: '#FAF8F5',
    foreground: '#2D2D3F',
    cursor: '#2D2D3F',
    cursorAccent: '#FAF8F5',
    selectionBackground: '#E8E4DF',
    selectionForeground: '#2D2D3F',
    black: '#2D2D3F',
    red: '#DC2626',
    green: '#66BB6A',
    yellow: '#E8A820',
    blue: '#3B329A',
    magenta: '#9333ea',
    cyan: '#0891b2',
    white: '#F0EDE6',
    brightBlack: '#8A8AA0',
    brightRed: '#ef4444',
    brightGreen: '#81C784',
    brightYellow: '#eab308',
    brightBlue: '#5C52C7',
    brightMagenta: '#a855f7',
    brightCyan: '#06b6d4',
    brightWhite: '#FAF8F5',
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
}

function buildTerminalTheme(values: Record<TerminalThemeKey, string>): ITheme {
  return { ...values }
}

function resolveTerminalTheme(mode: ThemeMode): Record<TerminalThemeKey, string> {
  const fallback = TERMINAL_THEME_FALLBACKS[mode]

  if (typeof document === 'undefined' || !document.body) {
    return fallback
  }

  const temp = document.createElement('div')
  temp.setAttribute('data-theme', THEME_NAMES[mode])
  temp.style.display = 'none'
  document.body.appendChild(temp)

  try {
    const styles = getComputedStyle(temp)

    return Object.fromEntries(
      Object.entries(TERMINAL_THEME_VARIABLES).map(([key, variableName]) => [
        key,
        styles.getPropertyValue(variableName).trim() || fallback[key as TerminalThemeKey],
      ])
    ) as Record<TerminalThemeKey, string>
  } finally {
    document.body.removeChild(temp)
  }
}

export function getTerminalTheme(mode: ThemeMode): ITheme {
  return buildTerminalTheme(resolveTerminalTheme(mode))
}

export function getDiffTheme(mode: ThemeMode): 'light' | 'dark' {
  return mode
}
