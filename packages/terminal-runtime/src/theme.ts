import type { TerminalViewTheme } from './terminalView'
import { writable } from 'svelte/store'

export type ThemeMode = 'light' | 'dark'

export const themeMode = writable<ThemeMode>('light')

const THEME_NAMES: Record<ThemeMode, string> = {
  light: 'openforge',
  dark: 'openforge-dark',
}

function themeModeFromDocumentTheme(themeName: string | null): ThemeMode {
  return themeName === THEME_NAMES.dark ? 'dark' : 'light'
}

export function syncThemeModeWithDocument(): void {
  if (typeof document === 'undefined') return

  themeMode.set(themeModeFromDocumentTheme(document.documentElement.getAttribute('data-theme')))
}

export function setupHostThemeSync(): () => void {
  syncThemeModeWithDocument()

  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => undefined
  }

  const observer = new MutationObserver(() => {
    syncThemeModeWithDocument()
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })

  return () => observer.disconnect()
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

// Light terminal palette follows GitHub Light Default's Ghostty-compatible colors.
const TERMINAL_THEME_FALLBACKS: Record<ThemeMode, Record<TerminalThemeKey, string>> = {
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
}

function buildTerminalTheme(values: Record<TerminalThemeKey, string>): TerminalViewTheme {
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

export function getTerminalTheme(mode: ThemeMode): TerminalViewTheme {
  return buildTerminalTheme(resolveTerminalTheme(mode))
}

export function getDiffTheme(mode: ThemeMode): 'light' | 'dark' {
  return mode
}
