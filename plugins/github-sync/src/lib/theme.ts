import { writable } from 'svelte/store'

export type ThemeMode = 'light' | 'dark' | 'system'
export const themeMode = writable<ThemeMode>('system')

export function getDiffTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}
