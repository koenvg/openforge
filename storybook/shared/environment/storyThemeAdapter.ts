import { get } from 'svelte/store'
import { themeRegistry } from '../../../src/lib/theme'
import type { StoryEnvironmentAdapter } from './storyEnvironment'

export function createStoryThemeAdapter(themeId: string): StoryEnvironmentAdapter {
  let previous: string | null = null
  return {
    async install() {
      previous = get(themeRegistry.selectedTheme).id
      await themeRegistry.selectTheme(themeId)
    },
    async reset() {
      await themeRegistry.selectTheme(themeId)
    },
    async dispose() {
      if (previous !== null) await themeRegistry.selectTheme(previous)
      previous = null
    },
  }
}
