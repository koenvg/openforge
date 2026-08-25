import { fromStore } from 'svelte/store'
import { applyTheme, themeMode } from '../../lib/theme'
import type { ThemeMode } from '../../lib/theme'

export function createSettingsThemeController() {
  const themeModeState = fromStore(themeMode)
  let isDarkMode = $state(themeModeState.current === 'dark')

  $effect(() => {
    isDarkMode = themeModeState.current === 'dark'
  })

  function toggle(): void {
    const next: ThemeMode = isDarkMode ? 'light' : 'dark'
    applyTheme(next)
  }

  return {
    get isDarkMode() { return isDarkMode },
    toggle,
  }
}

export type SettingsThemeController = ReturnType<typeof createSettingsThemeController>
