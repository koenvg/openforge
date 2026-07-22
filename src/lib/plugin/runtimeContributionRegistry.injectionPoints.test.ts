import { describe, it, expect } from 'vitest'
import { createRuntimeContributionRegistry } from './runtimeContributionRegistry'

describe('runtime registry — injectionPoints', () => {
  it('records a registration and lists it by location', () => {
    const registry = createRuntimeContributionRegistry({ pluginId: 'com.test.injectables', projectId: 'P-1' })
    const api = registry.getFrontendApi()

    const disposable = api.injectionPoints.register({
      id: 'picker',
      location: 'createTaskPrompt',
      component: (() => {}) as never,
    })

    expect(registry.listInjectionPoints('createTaskPrompt').map((c) => c.id)).toEqual(['picker'])
    expect(registry.listInjectionPoints('agentSession')).toEqual([])

    disposable.dispose()
    expect(registry.listInjectionPoints('createTaskPrompt')).toEqual([])
  })
})
