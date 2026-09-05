import { expect, it } from 'vitest'
import { get } from 'svelte/store'
import { selectedTheme } from '../../../src/lib/theme'
import { createStoryDesktopAdapter } from './storyDesktopAdapter'
import { createStoryThemeAdapter } from './storyThemeAdapter'

it('uses one theme for document styles and runtime subscribers, then restores it', async () => {
  const previous = get(selectedTheme).id
  const desktop = createStoryDesktopAdapter()
  const theme = createStoryThemeAdapter('openforge-dark')
  desktop.install()
  try {
    await theme.install()
    expect(get(selectedTheme).id).toBe('openforge-dark')
    expect(document.documentElement.dataset.theme).toBe('openforge-dark')
    await theme.dispose()
    expect(get(selectedTheme).id).toBe(previous)
    expect(document.documentElement.dataset.theme).toBe(previous)
  } finally {
    await theme.dispose()
    desktop.dispose()
  }
})
