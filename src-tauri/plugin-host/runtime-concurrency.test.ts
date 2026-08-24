import { describe, expect, it, vi } from 'vitest'
import { createPluginHostRuntime } from './index'
import { writeBackendModule } from './backend-module.test-fixtures'

describe('plugin-host backend concurrency', () => {
  it('keeps an active Project context while concurrent backend invocations omit projectId', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          globalThis.__contextualActivationCount = (globalThis.__contextualActivationCount ?? 0) + 1
          context.subscriptions.add(openforge.backend.registerMethod('get-dashboard', {
            handler() {
              return {
                activations: globalThis.__contextualActivationCount,
                projectId: openforge.context.getSnapshot().projectId
              }
            }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()
    const pluginId = 'contextual-plugin'

    await runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'plugin.backend.whenReady',
      params: { pluginId, backendPath, projectId: 'P-1' },
    })

    const responses = await Promise.all([2, 3].map((id) => runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id,
      method: 'plugin.backend.invoke',
      params: { pluginId, backendPath, command: 'get-dashboard' },
    })))

    expect(responses).toEqual([
      { jsonrpc: '2.0', id: 2, result: { activations: 1, projectId: 'P-1' } },
      { jsonrpc: '2.0', id: 3, result: { activations: 1, projectId: 'P-1' } },
    ])
  })

  it('serializes concurrent backend readiness changes for one plugin', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          globalThis.__serializedActivationCount = (globalThis.__serializedActivationCount ?? 0) + 1
          context.subscriptions.add(openforge.backend.registerMethod('snapshot', {
            handler() {
              return {
                activations: globalThis.__serializedActivationCount,
                projectId: openforge.context.getSnapshot().projectId
              }
            }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()
    const pluginId = 'serialized-plugin'

    await runtime.whenBackendReady({ pluginId, backendPath, projectId: 'P-1' })
    const readiness = await Promise.all([
      runtime.whenBackendReady({ pluginId, backendPath, projectId: 'P-2' }),
      runtime.whenBackendReady({ pluginId, backendPath, projectId: 'P-2' }),
    ])

    expect(readiness).toEqual([
      expect.objectContaining({ state: 'ready' }),
      expect.objectContaining({ state: 'ready' }),
    ])
    await expect(runtime.invokeBackend({ pluginId, command: 'snapshot' })).resolves.toEqual({
      activations: 2,
      projectId: 'P-2',
    })
  })

  it('serializes backend invocations for one plugin', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('work', {
            async handler(payload) {
              globalThis.__samePluginInvocationOrder.push('start:' + payload.label)
              if (payload.label === 'first') await globalThis.__samePluginInvocationGate
              globalThis.__samePluginInvocationOrder.push('end:' + payload.label)
              return payload.label
            }
          }))
        }
      }
    `)
    const globals = globalThis as typeof globalThis & {
      __samePluginInvocationOrder: string[]
      __samePluginInvocationGate?: Promise<void>
    }
    let releaseFirst: () => void = () => undefined
    globals.__samePluginInvocationOrder = []
    globals.__samePluginInvocationGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const runtime = createPluginHostRuntime()
    const request = (id: number, label: string) => runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id,
      method: 'plugin.backend.invoke',
      params: { pluginId: 'bounded', backendPath, command: 'work', payload: { label } },
    })

    const first = request(1, 'first')
    const second = request(2, 'second')
    try {
      await vi.waitFor(() => {
        expect(globals.__samePluginInvocationOrder).toEqual(['start:first'])
      })
      expect(globals.__samePluginInvocationOrder).toEqual(['start:first'])

      releaseFirst()
      await expect(Promise.all([first, second])).resolves.toEqual([
        { jsonrpc: '2.0', id: 1, result: 'first' },
        { jsonrpc: '2.0', id: 2, result: 'second' },
      ])
      expect(globals.__samePluginInvocationOrder).toEqual([
        'start:first',
        'end:first',
        'start:second',
        'end:second',
      ])
    } finally {
      releaseFirst()
      await Promise.allSettled([first, second])
      delete globals.__samePluginInvocationGate
      delete (globals as Partial<typeof globals>).__samePluginInvocationOrder
    }
  })

  it('does not let a long-running backend handler block another plugin invocation', async () => {
    const blockingBackendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('block', {
            async handler() {
              globalThis.__markBlockingHandlerStarted()
              await new Promise(resolve => { globalThis.__releaseBlockingHandler = resolve })
              return 'released'
            }
          }))
        }
      }
    `)
    const readyBackendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('ping', { handler() { return 'pong' } }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()
    const globals = globalThis as typeof globalThis & {
      __markBlockingHandlerStarted?: () => void
      __releaseBlockingHandler?: () => void
    }
    let markStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    globals.__markBlockingHandlerStarted = markStarted

    const blockingCall = runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 10,
      method: 'plugin.backend.invoke',
      params: { pluginId: 'blocking', backendPath: blockingBackendPath, command: 'block' },
    })
    await started

    const readiness = runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 11,
      method: 'plugin.backend.invoke',
      params: { pluginId: 'ready', backendPath: readyBackendPath, command: 'ping' },
    })
    let readinessOutcome: 'ready' | 'blocked'
    let blockedTimer: ReturnType<typeof setTimeout> | undefined
    try {
      readinessOutcome = await Promise.race([
        readiness.then(() => 'ready' as const),
        new Promise<'blocked'>((resolve) => {
          blockedTimer = setTimeout(() => resolve('blocked'), 1_000)
        }),
      ])
    } finally {
      if (blockedTimer) clearTimeout(blockedTimer)
      globals.__releaseBlockingHandler?.()
      await blockingCall
      await expect(readiness).resolves.toEqual({ jsonrpc: '2.0', id: 11, result: 'pong' })
      delete globals.__markBlockingHandlerStarted
      delete globals.__releaseBlockingHandler
    }

    expect(readinessOutcome).toBe('ready')
  })

  it('stops a background service that finishes starting after deactivation', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.background.register({
            id: 'delayed',
            scope: 'global',
            async start() {
              globalThis.__markDelayedServiceStarted?.()
              await globalThis.__delayedServiceGate
              globalThis.__delayedServiceEvents = [...(globalThis.__delayedServiceEvents ?? []), 'start']
            },
            stop() {
              globalThis.__delayedServiceEvents = [...(globalThis.__delayedServiceEvents ?? []), 'stop']
            }
          }))
        }
      }
    `)
    const globals = globalThis as typeof globalThis & {
      __delayedServiceEvents?: string[]
      __delayedServiceGate?: Promise<void>
      __markDelayedServiceStarted?: () => void
    }
    let markServiceStarted: () => void = () => undefined
    let releaseService: () => void = () => undefined
    const serviceStarted = new Promise<void>((resolve) => { markServiceStarted = resolve })
    globals.__markDelayedServiceStarted = markServiceStarted
    globals.__delayedServiceGate = new Promise<void>((resolve) => { releaseService = resolve })
    const runtime = createPluginHostRuntime()
    const activation = runtime.activateBackend({ pluginId: 'delayed-service', backendPath })
    let serviceStartTimer: ReturnType<typeof setTimeout> | undefined
    try {
      const serviceStartOutcome = await Promise.race([
        serviceStarted.then(() => 'started' as const),
        activation.then(() => 'finished' as const),
        new Promise<'timed-out'>((resolve) => {
          serviceStartTimer = setTimeout(() => resolve('timed-out'), 1_000)
        }),
      ])
      if (serviceStartTimer) clearTimeout(serviceStartTimer)
      expect(serviceStartOutcome).toBe('started')

      await runtime.deactivateBackend('delayed-service')
      releaseService()
      await activation

      expect(globals.__delayedServiceEvents).toEqual(['start', 'stop'])
      expect(await runtime.getBackendState('delayed-service')).toMatchObject({ state: 'missing' })
    } finally {
      if (serviceStartTimer) clearTimeout(serviceStartTimer)
      releaseService()
      await Promise.allSettled([activation])
      delete globals.__delayedServiceEvents
      delete globals.__delayedServiceGate
      delete globals.__markDelayedServiceStarted
    }
  })

  it('deactivates promptly while serializing reload behind in-flight activation', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          globalThis.__reloadActivationCount = (globalThis.__reloadActivationCount ?? 0) + 1
          if (globalThis.__reloadActivationCount === 1) {
            globalThis.__markReloadActivationStarted?.()
            await globalThis.__reloadActivationGate
            context.subscriptions.add(() => { globalThis.__staleActivationCleanups = (globalThis.__staleActivationCleanups ?? 0) + 1 })
          }
          context.subscriptions.add(openforge.commands.register({
            id: 'get-handoff-notes',
            title: 'Get handoff notes',
            agent: { description: 'Get handoff notes for a task.' },
            handler() { return { notes: [] } }
          }))
        }
      }
    `)
    const globals = globalThis as typeof globalThis & {
      __markReloadActivationStarted?: () => void
      __reloadActivationCount?: number
      __staleActivationCleanups?: number
      __reloadActivationGate?: Promise<void>
    }
    let markActivationStarted: () => void = () => undefined
    let releaseActivation: () => void = () => undefined
    const activationStarted = new Promise<void>((resolve) => { markActivationStarted = resolve })
    globals.__markReloadActivationStarted = markActivationStarted
    globals.__reloadActivationGate = new Promise<void>((resolve) => { releaseActivation = resolve })
    const pluginId = 'com.openforge.handoff-notes-workflow'
    const runtime = createPluginHostRuntime({ crashLoopLimit: 1 })
    const activation = runtime.activateBackend({ pluginId, backendPath, projectId: 'KVG' })
    let activationTimer: ReturnType<typeof setTimeout> | undefined
    let deactivationTimer: ReturnType<typeof setTimeout> | undefined
    try {
      const activationOutcome = await Promise.race([
        activationStarted.then(() => 'started' as const),
        activation.then(() => 'finished' as const),
        new Promise<'timed-out'>((resolve) => {
          activationTimer = setTimeout(() => resolve('timed-out'), 1_000)
        }),
      ])
      if (activationTimer) clearTimeout(activationTimer)
      expect(activationOutcome).toBe('started')

      const deactivations = [
        runtime.deactivateBackend(pluginId),
        runtime.deactivateBackend(pluginId),
      ]
      const deactivationOutcome = await Promise.race([
        Promise.all(deactivations).then(() => 'deactivated' as const),
        new Promise<'blocked'>((resolve) => {
          deactivationTimer = setTimeout(() => resolve('blocked'), 50)
        }),
      ])
      if (deactivationTimer) clearTimeout(deactivationTimer)

      expect(deactivationOutcome).toBe('deactivated')

      const reloads = deactivations.map(async (deactivation) => {
        await deactivation
        return await runtime.activateBackend({ pluginId, backendPath, projectId: 'KVG' })
      })
      releaseActivation()

      await expect(Promise.all([activation, ...reloads])).resolves.toEqual([
        expect.objectContaining({ state: 'missing' }),
        expect.objectContaining({ state: 'ready' }),
        expect.objectContaining({ state: 'ready' }),
      ])

      expect(globals.__staleActivationCleanups).toBe(1)
      expect(await runtime.listAgentCommands({ pluginId, backendPath, projectId: 'KVG' })).toEqual([
        expect.objectContaining({ qualifiedId: `${pluginId}.get-handoff-notes` }),
      ])
      expect(await runtime.getBackendState(pluginId)).toMatchObject({
        state: 'ready',
        crashLoopGuardTripped: false,
      })
    } finally {
      if (activationTimer) clearTimeout(activationTimer)
      if (deactivationTimer) clearTimeout(deactivationTimer)
      releaseActivation()
      await Promise.allSettled([activation])
      delete globals.__markReloadActivationStarted
      delete globals.__reloadActivationCount
      delete globals.__staleActivationCleanups
      delete globals.__reloadActivationGate
    }
  })
})
