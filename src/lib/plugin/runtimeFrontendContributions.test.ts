import { describe, expect, it } from 'vitest'
import { RuntimeContributionClaims, RuntimeRegistryServices } from './runtimeContributionSupport'
import { RuntimeFrontendContributionRegistry } from './runtimeFrontendContributions'
import { LIGHT_THEME } from '../themeContract'

const PluginView = (() => undefined) as never

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
})
