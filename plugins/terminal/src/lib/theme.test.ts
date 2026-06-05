import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { setupHostThemeSync, syncThemeModeWithDocument, themeMode } from './theme'

async function flushMutationObserver() {
  await Promise.resolve()
}

describe('terminal plugin theme synchronization', () => {
  beforeEach(() => {
    themeMode.set('light')
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
    themeMode.set('light')
  })

  it('initializes from the current host document theme before terminals are created', () => {
    document.documentElement.setAttribute('data-theme', 'openforge-dark')

    syncThemeModeWithDocument()

    expect(get(themeMode)).toBe('dark')
  })

  it('falls back to light for the light host document theme', () => {
    themeMode.set('dark')
    document.documentElement.setAttribute('data-theme', 'openforge')

    syncThemeModeWithDocument()

    expect(get(themeMode)).toBe('light')
  })

  it('keeps the plugin terminal theme synced when the host theme changes', async () => {
    const stopSync = setupHostThemeSync()

    document.documentElement.setAttribute('data-theme', 'openforge-dark')
    await flushMutationObserver()

    expect(get(themeMode)).toBe('dark')

    document.documentElement.setAttribute('data-theme', 'openforge')
    await flushMutationObserver()

    expect(get(themeMode)).toBe('light')

    stopSync()
  })
})
