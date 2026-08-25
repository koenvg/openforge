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

export function getDiffTheme(mode: ThemeMode): 'light' | 'dark' {
  return mode
}
