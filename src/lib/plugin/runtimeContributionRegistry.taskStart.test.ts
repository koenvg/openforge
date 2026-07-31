import { describe, it, expect, vi } from 'vitest'
import { createRuntimeContributionRegistry } from './runtimeContributionRegistry'

const createRegistry = (pluginId: string) =>
  createRuntimeContributionRegistry({ pluginId, projectId: 'P-1' })

describe('runtime registry — taskStart prefix providers', () => {
  it('registers a provider and lists it with its qualified id', () => {
    const registry = createRegistry('com.example.a')

    registry.getFrontendApi().taskStart.registerPrefixProvider({
      id: 'injectable',
      title: 'Start with injectable…',
      provide: async () => 'prefix text',
    })

    const listed = registry.listTaskStartPrefixProviders()
    expect(listed).toHaveLength(1)
    expect(listed[0].qualifiedId).toBe('com.example.a.injectable')
    expect(listed[0].title).toBe('Start with injectable…')
    expect(listed[0].order).toBe(0)
  })

  it('drops the provider when its subscription is disposed', () => {
    const registry = createRegistry('com.example.a')

    const subscription = registry.getFrontendApi().taskStart.registerPrefixProvider({
      id: 'injectable',
      title: 'Start with injectable…',
      provide: async () => null,
    })
    subscription.dispose()

    expect(registry.listTaskStartPrefixProviders()).toEqual([])
  })

  it('rejects a registration with no title', () => {
    const registry = createRegistry('com.example.a')

    expect(() =>
      registry.getFrontendApi().taskStart.registerPrefixProvider({
        id: 'injectable',
        title: '',
        provide: async () => null,
      }),
    ).toThrow()
  })

  it('rejects a registration with no provide function', () => {
    const registry = createRegistry('com.example.a')

    expect(() =>
      registry.getFrontendApi().taskStart.registerPrefixProvider({
        id: 'injectable',
        title: 'Start with injectable…',
      } as never),
    ).toThrow()
  })

  it('sorts listed providers by order then qualified id', () => {
    const registry = createRegistry('com.example.a')
    const api = registry.getFrontendApi()

    api.taskStart.registerPrefixProvider({ id: 'zulu', title: 'Zulu', order: 5, provide: async () => null })
    api.taskStart.registerPrefixProvider({ id: 'alpha', title: 'Alpha', order: 1, provide: async () => null })

    expect(registry.listTaskStartPrefixProviders().map((provider) => provider.id)).toEqual(['alpha', 'zulu'])
  })

  it('passes the context through to provide', async () => {
    const registry = createRegistry('com.example.a')
    const provide = vi.fn().mockResolvedValue('chosen')

    registry.getFrontendApi().taskStart.registerPrefixProvider({
      id: 'injectable',
      title: 'Start with injectable…',
      provide,
    })

    const [provider] = registry.listTaskStartPrefixProviders()
    await expect(provider.provide({ taskId: 'T-1', projectId: 'P-1' })).resolves.toBe('chosen')
    expect(provide).toHaveBeenCalledWith({ taskId: 'T-1', projectId: 'P-1' })
  })
})
