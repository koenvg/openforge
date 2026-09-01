import { get } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_DARK_THEME_ID, BUILTIN_LIGHT_THEME_ID, LIGHT_THEME } from './themeContract'
import { createThemeRuntime, getDiffTheme } from './theme'

function createRuntime(storedTheme: string | null) {
  const root = document.createElement('html')
  const getStoredThemeId = vi.fn(async () => storedTheme)
  const persistThemeId = vi.fn(async () => undefined)
  const reportDiagnostic = vi.fn()
  const runtime = createThemeRuntime({
    root,
    getStoredThemeId,
    persistThemeId,
    reportDiagnostic,
  })
  return { root, getStoredThemeId, persistThemeId, reportDiagnostic, runtime }
}

describe('theme runtime', () => {
  it('makes built-in light available and applied before asynchronous initialization', () => {
    const { root, runtime } = createRuntime(null)

    expect(get(runtime.registry.availableThemes).map((theme) => theme.id)).toContain(BUILTIN_LIGHT_THEME_ID)
    expect(get(runtime.registry.selectedTheme).id).toBe(BUILTIN_LIGHT_THEME_ID)
    expect(root.dataset.theme).toBe(BUILTIN_LIGHT_THEME_ID)
    expect(root.style.getPropertyValue('--of-canvas')).toBe(LIGHT_THEME.tokens.canvas)
  })

  it.each([
    ['light', BUILTIN_LIGHT_THEME_ID, 'light'],
    ['dark', BUILTIN_DARK_THEME_ID, 'dark'],
  ] as const)('migrates stored %s to its stable built-in id', async (stored, expectedId, appearance) => {
    const { root, persistThemeId, runtime } = createRuntime(stored)

    await runtime.initialize()

    expect(root.dataset.theme).toBe(expectedId)
    expect(root.dataset.themeAppearance).toBe(appearance)
    expect(persistThemeId).toHaveBeenCalledWith(expectedId)
  })

  it('restores a stable contributed theme id after it has been registered', async () => {
    const { persistThemeId, runtime } = createRuntime('com.example.theme:paper')
    runtime.registry.registerContributedTheme({
      ...LIGHT_THEME,
      id: 'com.example.theme:paper',
      label: 'Paper',
    }, {
      pluginId: 'com.example.theme',
      generation: 3,
    })

    await runtime.initialize()

    expect(get(runtime.registry.selectedTheme).id).toBe('com.example.theme:paper')
    expect(persistThemeId).toHaveBeenCalledWith('com.example.theme:paper')
  })

  it('persists and diagnoses built-in light fallback for an invalid or unavailable stored id', async () => {
    const { persistThemeId, reportDiagnostic, runtime } = createRuntime('missing theme')

    await runtime.initialize()

    expect(get(runtime.registry.selectedTheme).id).toBe(BUILTIN_LIGHT_THEME_ID)
    expect(persistThemeId).toHaveBeenCalledWith(BUILTIN_LIGHT_THEME_ID)
    expect(reportDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      code: 'theme-unavailable',
      themeId: 'missing theme',
      fallbackThemeId: BUILTIN_LIGHT_THEME_ID,
    }))
  })

  it('retains the legacy light/dark adapter for untouched callers', async () => {
    const { root, runtime } = createRuntime(null)

    await runtime.applyTheme('dark')

    expect(root.dataset.theme).toBe(BUILTIN_DARK_THEME_ID)
    expect(get(runtime.themeMode)).toBe('dark')
    expect(getDiffTheme('dark')).toBe('dark')
  })
})
