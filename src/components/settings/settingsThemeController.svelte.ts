import { fromStore } from 'svelte/store'
import { error } from '../../lib/stores'
import { availableThemes, selectedTheme, themeRegistry } from '../../lib/theme'

function getErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

export function createSettingsThemeController() {
  const availableThemesState = fromStore(availableThemes)
  const selectedThemeState = fromStore(selectedTheme)

  async function select(themeId: string): Promise<void> {
    try {
      await themeRegistry.selectTheme(themeId)
    } catch (value) {
      error.set(`Failed to save theme: ${getErrorMessage(value)}`)
    }
  }

  return {
    get availableThemes() { return availableThemesState.current },
    get selectedThemeId() { return selectedThemeState.current.id },
    select,
  }
}

export type SettingsThemeController = ReturnType<typeof createSettingsThemeController>
