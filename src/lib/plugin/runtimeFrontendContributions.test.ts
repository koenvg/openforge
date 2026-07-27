import { describe, expect, it } from 'vitest'
import { RuntimeContributionClaims, RuntimeRegistryServices } from './runtimeContributionSupport'
import { RuntimeFrontendContributionRegistry } from './runtimeFrontendContributions'

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
})
