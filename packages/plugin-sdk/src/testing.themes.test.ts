import { describe, expect, it } from 'vitest'

import { THEME_TOKEN_NAMES } from './index'
import { createMockFrontendOpenForgeApi, createOpenForgeRegistryFake } from './testing'
import type { PluginThemeDefinition, ThemeTokens } from './frontend'

function completeTokens(): ThemeTokens {
  return Object.fromEntries(THEME_TOKEN_NAMES.map((name) => [name, `var(--test-${name})`])) as unknown as ThemeTokens
}

function theme(overrides: Partial<PluginThemeDefinition> = {}): PluginThemeDefinition {
  return {
    id: 'paper',
    label: 'Paper',
    appearance: 'light',
    tokens: completeTokens(),
    ...overrides,
  }
}

function appThemeApi() {
  return createMockFrontendOpenForgeApi({
    pluginId: 'acme.theme',
    packageMetadata: {
      id: 'acme.theme',
      apiVersion: 1,
      displayName: 'Acme Theme',
      description: 'Themes from Acme',
      enablement: 'app',
      frontend: './dist/frontend.js',
      requires: ['appEnablement', 'themes'],
    },
  })
}

describe('plugin SDK theme testing fake', () => {
  it('qualifies and records complete theme registrations', () => {
    const api = appThemeApi()
    const definition = theme()

    api.themes.register(definition)

    expect(api.__testing.registry.snapshot.themes).toMatchObject([{
      id: 'paper',
      qualifiedId: 'acme.theme:paper',
      pluginId: 'acme.theme',
      projectId: null,
      label: 'Paper',
      appearance: 'light',
    }])
    expect(api.__testing.calls.themeRegistrations).toEqual([definition])
  })

  it('returns a disposable theme registration', async () => {
    const api = appThemeApi()
    const registration = api.themes.register(theme())

    await registration.dispose()
    await registration.dispose()

    expect(api.__testing.registry.snapshot.themes).toEqual([])
  })

  it('rejects duplicate local theme ids without replacing the first', () => {
    const api = appThemeApi()
    api.themes.register(theme({ label: 'First' }))

    expect(() => api.themes.register(theme({ label: 'Second' })))
      .toThrow('Duplicate runtime contribution id: acme.theme:paper')
    expect(api.__testing.registry.snapshot.themes).toMatchObject([{ label: 'First' }])
  })

  it('rejects incomplete and invalid theme definitions', () => {
    const api = appThemeApi()
    const tokens = { ...completeTokens() } as Partial<ThemeTokens>
    Reflect.deleteProperty(tokens, 'focusRing')

    expect(() => api.themes.register(theme({ tokens: tokens as ThemeTokens })))
      .toThrow('themes registration tokens.focusRing is required')
    expect(() => api.themes.register(theme({ appearance: 'dim' as never })))
      .toThrow('themes registration appearance must be light or dark')
    expect(api.__testing.registry.snapshot.themes).toEqual([])
  })

  it('rejects registration without the declared themes capability', () => {
    const api = createMockFrontendOpenForgeApi({
      pluginId: 'acme.theme',
      packageMetadata: {
        id: 'acme.theme',
        apiVersion: 1,
        displayName: 'Acme Theme',
        description: 'Themes from Acme',
        enablement: 'app',
        frontend: './dist/frontend.js',
        requires: ['appEnablement'],
      },
    })

    expect(() => api.themes.register(theme()))
      .toThrow('themes registration requires the themes capability')
  })

  it('rejects project-enabled theme registration', () => {
    const api = createMockFrontendOpenForgeApi({
      pluginId: 'acme.theme',
      projectId: 'P-1',
      packageMetadata: {
        id: 'acme.theme',
        apiVersion: 1,
        displayName: 'Acme Theme',
        description: 'Themes from Acme',
        frontend: './dist/frontend.js',
        requires: ['themes'],
      },
    })

    expect(() => api.themes.register(theme()))
      .toThrow('themes registration requires app enablement')
  })

  it.each(['openforge-light', 'openforge-dark', 'openforge.custom'])('rejects reserved local theme id %s', (id) => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'acme.theme',
      packageMetadata: {
        id: 'acme.theme',
        apiVersion: 1,
        displayName: 'Acme Theme',
        description: 'Themes from Acme',
        enablement: 'app',
        frontend: './dist/frontend.js',
        requires: ['appEnablement', 'themes'],
      },
    })

    expect(() => registry.frontendApi.themes.register(theme({ id })))
      .toThrow(/themes registration cannot use reserved id/i)
  })
})
