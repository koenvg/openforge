import { get } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_LIGHT_THEME_ID,
  DARK_THEME,
  LIGHT_THEME,
  type ThemeDefinition,
} from './themeContract'
import { createThemeRegistry } from './themeRegistry'

function contributedTheme(id = 'com.example.theme:paper'): ThemeDefinition {
  return {
    ...LIGHT_THEME,
    id,
    label: 'Paper',
    tokens: { ...LIGHT_THEME.tokens, canvas: '#FAF7F0' },
  }
}

describe('theme registry', () => {
  it('makes immutable built-in snapshots available immediately', () => {
    const registry = createThemeRegistry()
    const snapshot = get(registry.snapshot)

    expect(snapshot.availableThemes.map((theme) => theme.id)).toEqual([
      LIGHT_THEME.id,
      DARK_THEME.id,
    ])
    expect(snapshot.selectedTheme.id).toBe(BUILTIN_LIGHT_THEME_ID)
    expect(snapshot.availableThemes[0]?.owner).toEqual({ kind: 'builtin' })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.availableThemes)).toBe(true)
    expect(Object.isFrozen(snapshot.availableThemes[0])).toBe(true)
    expect(Object.isFrozen(snapshot.availableThemes[0]?.tokens)).toBe(true)
  })

  it('registers contributed themes with generation-aware ownership and rejects duplicates', () => {
    const registry = createThemeRegistry()
    const owner = { pluginId: 'com.example.theme', generation: 7 }
    registry.registerContributedTheme(contributedTheme(), owner)

    expect(get(registry.availableThemes).at(-1)).toMatchObject({
      id: 'com.example.theme:paper',
      owner: { kind: 'plugin', ...owner },
    })
    expect(() => registry.registerContributedTheme(contributedTheme(), owner))
      .toThrow('Theme id already registered: com.example.theme:paper')
    expect(get(registry.availableThemes).filter((theme) => theme.id === 'com.example.theme:paper')).toHaveLength(1)
  })

  it('selects a registered theme through the adapter and persists its stable id', async () => {
    const applyTheme = vi.fn()
    const persistSelection = vi.fn(async () => undefined)
    const registry = createThemeRegistry({ applyTheme, persistSelection })

    await registry.selectTheme(DARK_THEME.id)

    expect(applyTheme).toHaveBeenCalledWith(expect.objectContaining({
      id: DARK_THEME.id,
      appearance: 'dark',
    }))
    expect(get(registry.selectedTheme).id).toBe(DARK_THEME.id)
    expect(persistSelection).toHaveBeenCalledWith(DARK_THEME.id)
  })

  it('unregisters an inactive contribution without changing selection', async () => {
    const persistSelection = vi.fn(async () => undefined)
    const registry = createThemeRegistry({ persistSelection })
    const registration = registry.registerContributedTheme(contributedTheme(), {
      pluginId: 'com.example.theme',
      generation: 1,
    })

    await registration.dispose()

    expect(get(registry.selectedTheme).id).toBe(BUILTIN_LIGHT_THEME_ID)
    expect(get(registry.availableThemes).some((theme) => theme.id === 'com.example.theme:paper')).toBe(false)
    expect(persistSelection).not.toHaveBeenCalled()
  })

  it('atomically applies and persists built-in light when the active contribution disappears', async () => {
    const applyTheme = vi.fn()
    const persistSelection = vi.fn(async () => undefined)
    const reportDiagnostic = vi.fn()
    const registry = createThemeRegistry({ applyTheme, persistSelection, reportDiagnostic })
    const registration = registry.registerContributedTheme(contributedTheme(), {
      pluginId: 'com.example.theme',
      generation: 2,
    })
    await registry.selectTheme('com.example.theme:paper')
    const observed: Array<{ selected: string; available: string[] }> = []
    const unsubscribe = registry.snapshot.subscribe((snapshot) => {
      observed.push({
        selected: snapshot.selectedTheme.id,
        available: snapshot.availableThemes.map((theme) => theme.id),
      })
    })
    observed.length = 0

    await registration.dispose()
    unsubscribe()

    expect(observed).toEqual([{
      selected: BUILTIN_LIGHT_THEME_ID,
      available: [LIGHT_THEME.id, DARK_THEME.id],
    }])
    expect(applyTheme).toHaveBeenLastCalledWith(expect.objectContaining({ id: BUILTIN_LIGHT_THEME_ID }))
    expect(persistSelection).toHaveBeenLastCalledWith(BUILTIN_LIGHT_THEME_ID)
    expect(reportDiagnostic).toHaveBeenCalledWith({
      code: 'theme-unavailable',
      themeId: 'com.example.theme:paper',
      fallbackThemeId: BUILTIN_LIGHT_THEME_ID,
      reason: 'unregistered',
    })
  })

  it('falls back deterministically when an invalid or unknown id is selected', async () => {
    const persistSelection = vi.fn(async () => undefined)
    const reportDiagnostic = vi.fn()
    const registry = createThemeRegistry({ persistSelection, reportDiagnostic })

    await registry.selectTheme('missing theme')

    expect(get(registry.selectedTheme).id).toBe(BUILTIN_LIGHT_THEME_ID)
    expect(persistSelection).toHaveBeenCalledWith(BUILTIN_LIGHT_THEME_ID)
    expect(reportDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      code: 'theme-unavailable',
      themeId: 'missing theme',
      fallbackThemeId: BUILTIN_LIGHT_THEME_ID,
      reason: 'invalid-or-unavailable',
    }))
  })

  it('diagnoses unavailable fallback even when persistence fails', async () => {
    const persistenceError = new Error('config unavailable')
    const reportDiagnostic = vi.fn()
    const registry = createThemeRegistry({
      persistSelection: vi.fn(async () => { throw persistenceError }),
      reportDiagnostic,
    })

    await expect(registry.selectTheme('missing-theme')).rejects.toBe(persistenceError)

    expect(get(registry.selectedTheme).id).toBe(BUILTIN_LIGHT_THEME_ID)
    expect(reportDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      code: 'theme-unavailable',
      themeId: 'missing-theme',
      fallbackThemeId: BUILTIN_LIGHT_THEME_ID,
    }))
  })
})
