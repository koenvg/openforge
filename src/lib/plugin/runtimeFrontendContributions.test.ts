import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import { RuntimeContributionClaims, RuntimeRegistryServices } from './runtimeContributionSupport'
import { RuntimeFrontendContributionRegistry } from './runtimeFrontendContributions'
import { LIGHT_THEME } from '../themeContract'
import { createThemeRegistry, type ThemeRegistry } from '../themeRegistry'

const PluginView = (() => undefined) as never

function createThemeServices(): RuntimeRegistryServices {
  return new RuntimeRegistryServices({
    pluginId: 'theme-pack',
    projectId: null,
    packageMetadata: {
      id: 'theme-pack',
      apiVersion: 1,
      displayName: 'Theme Pack',
      description: 'Theme pack',
      enablement: 'app',
      frontend: './frontend.js',
      requires: ['appEnablement', 'themes'],
    },
  })
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>(complete => { resolve = complete }),
    resolve,
  }
}

describe('RuntimeFrontendContributionRegistry', () => {
  it('owns visual contribution registration and disposal independently', async () => {
    const claims = new RuntimeContributionClaims()
    const services = new RuntimeRegistryServices({ pluginId: 'github', projectId: 'project-1', claims })
    const registry = new RuntimeFrontendContributionRegistry(services, async () => undefined)
    const api = registry.createApi()

    const disposable = api.views.register({
      id: 'pull-requests',
      title: 'Pull Requests',
      icon: 'git-pull-request',
      placement: 'rail',
      component: PluginView,
    })

    expect(registry.getSnapshot().views).toMatchObject([
      { id: 'pull-requests', qualifiedId: 'github.pull-requests', projectId: 'project-1' },
    ])

    await disposable.dispose()

    expect(registry.getSnapshot().views).toEqual([])
    expect(claims.has('views', 'github.pull-requests')).toBe(false)
  })

  it('enforces app enablement and the themes capability before recording theme contributions', async () => {
    const definition = { ...LIGHT_THEME, id: 'paper', label: 'Paper' }
    const missingCapability = new RuntimeFrontendContributionRegistry(
      new RuntimeRegistryServices({
        pluginId: 'theme-pack',
        projectId: null,
        packageMetadata: {
          id: 'theme-pack',
          apiVersion: 1,
          displayName: 'Theme Pack',
          description: 'Theme pack',
          enablement: 'app',
          frontend: './frontend.js',
          requires: ['appEnablement'],
        },
      }),
      async () => undefined,
    )
    expect(() => missingCapability.createApi().themes.register(definition))
      .toThrow('themes registration requires the themes capability')

    const projectEnabled = new RuntimeFrontendContributionRegistry(
      new RuntimeRegistryServices({
        pluginId: 'theme-pack',
        projectId: 'project-1',
        packageMetadata: {
          id: 'theme-pack',
          apiVersion: 1,
          displayName: 'Theme Pack',
          description: 'Theme pack',
          frontend: './frontend.js',
          requires: ['themes'],
        },
      }),
      async () => undefined,
    )
    expect(() => projectEnabled.createApi().themes.register(definition))
      .toThrow('themes registration requires app enablement')

    const appEnabled = new RuntimeFrontendContributionRegistry(
      new RuntimeRegistryServices({
        pluginId: 'theme-pack',
        projectId: null,
        packageMetadata: {
          id: 'theme-pack',
          apiVersion: 1,
          displayName: 'Theme Pack',
          description: 'Theme pack',
          enablement: 'app',
          frontend: './frontend.js',
          requires: ['appEnablement', 'themes'],
        },
      }),
      async () => undefined,
    )
    const disposable = appEnabled.createApi().themes.register(definition)
    expect(appEnabled.getSnapshot().themes).toMatchObject([{
      id: 'paper',
      qualifiedId: 'theme-pack:paper',
      pluginId: 'theme-pack',
      projectId: null,
    }])
    await disposable.dispose()
    expect(appEnabled.getSnapshot().themes).toEqual([])
  })

  it('includes registrations made while the browser theme host is resolving', async () => {
    const host = createThemeRegistry()
    const hostResolution = deferred<ThemeRegistry | null>()
    const registry = new RuntimeFrontendContributionRegistry(
      createThemeServices(),
      async () => undefined,
      () => hostResolution.promise,
    )
    const preparing = registry.prepareThemes()

    registry.createApi().themes.register({ ...LIGHT_THEME, id: 'paper', label: 'Paper' })
    hostResolution.resolve(host)
    await preparing

    expect(registry.commitThemes(4, () => true)).toBe(true)
    expect(get(host.availableThemes).find(theme => theme.id === 'theme-pack:paper')).toMatchObject({
      owner: { kind: 'plugin', pluginId: 'theme-pack', generation: 4 },
    })
  })

  it('does not publish themes when the activation generation goes stale while the host resolves', async () => {
    const host = createThemeRegistry()
    const hostResolution = deferred<ThemeRegistry | null>()
    const registry = new RuntimeFrontendContributionRegistry(
      createThemeServices(),
      async () => undefined,
      () => hostResolution.promise,
    )
    registry.createApi().themes.register({ ...LIGHT_THEME, id: 'paper', label: 'Paper' })
    const preparing = registry.prepareThemes()
    let generationCurrent = true

    generationCurrent = false
    hostResolution.resolve(host)
    await preparing

    expect(registry.commitThemes(4, () => generationCurrent)).toBe(false)
    expect(get(host.availableThemes).some(theme => theme.id === 'theme-pack:paper')).toBe(false)
  })
})
