import { dirname, join } from 'node:path'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { createPluginHostRuntime } from './index'
import { expectOnlyPluginHostStderr, updateBackendModule, writeBackendModule, writeCommonJsModule, writeEsmBackendModule } from './backend-module.test-fixtures'

describe('plugin-host backend lifecycle', () => {
  it('activates backend entries and invokes registered plugin-local RPC methods when ready', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          globalThis.__rpcActivation = (globalThis.__rpcActivation ?? 0) + 1
          context.subscriptions.add(openforge.backend.registerMethod('syncProject', {
            async handler(input) {
              return { pluginId: context.pluginId, projectId: input.projectId, activated: globalThis.__rpcActivation }
            }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    expect(await runtime.getBackendState('github')).toMatchObject({ state: 'missing' })
    await expect(runtime.invokeBackend({ pluginId: 'github', command: 'syncProject', payload: { projectId: 'P-1' } })).rejects.toThrow(/not ready/i)

    const result = await runtime.invokeBackend({ pluginId: 'github', backendPath, command: 'syncProject', payload: { projectId: 'P-1' } })

    expect(result).toEqual({ pluginId: 'github', projectId: 'P-1', activated: 1 })
    expect(await runtime.getBackendState('github')).toMatchObject({ state: 'ready', ready: true })
  })


  it('activates legacy ESM backend.js entries installed before worker isolation', async () => {
    const backendPath = await writeEsmBackendModule(`
      export default {
        activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('legacy', {
            handler() { return 'loaded' }
          }))
        }
      }
    `, 'js')
    const runtime = createPluginHostRuntime()

    await expect(runtime.invokeBackend({ pluginId: 'legacy-esm', backendPath, command: 'legacy' }))
      .resolves.toBe('loaded')
    await runtime.deactivateBackend('legacy-esm')
  })
  it('starts backend background services after activation and stops them during deactivation', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.background.register({
            id: 'sync',
            scope: 'project',
            start() { globalThis.__serviceEvents = [...(globalThis.__serviceEvents ?? []), 'start:' + context.pluginId] },
            stop() { globalThis.__serviceEvents = [...(globalThis.__serviceEvents ?? []), 'stop:' + context.pluginId] }
          }))
          context.subscriptions.add(openforge.backend.registerMethod('events', {
            handler() { return globalThis.__serviceEvents }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    expect(await runtime.invokeBackend({ pluginId: 'worker', backendPath, command: 'events' })).toEqual(['start:worker'])
    await runtime.deactivateBackend('worker')

    expect((globalThis as typeof globalThis & { __serviceEvents?: string[] }).__serviceEvents).toEqual(['start:worker', 'stop:worker'])
    expect(await runtime.getBackendState('worker')).toMatchObject({ state: 'missing' })
  })

  it('updates backend context across Project changes without restarting app-owned services', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          globalThis.__contextActivationCount = (globalThis.__contextActivationCount ?? 0) + 1
          context.subscriptions.add(context.onDidChange((snapshot) => {
            globalThis.__contextChanges = [...(globalThis.__contextChanges ?? []), snapshot.projectId]
          }))
          context.subscriptions.add(openforge.background.register({
            id: 'usage',
            scope: 'global',
            start() { globalThis.__contextStarts = (globalThis.__contextStarts ?? 0) + 1 },
            stop() { globalThis.__contextStops = (globalThis.__contextStops ?? 0) + 1 }
          }))
          context.subscriptions.add(openforge.backend.registerMethod('snapshot', {
            handler() {
              return {
                context: openforge.context.getSnapshot(),
                activations: globalThis.__contextActivationCount,
                starts: globalThis.__contextStarts,
                stops: globalThis.__contextStops ?? 0,
                contextChanges: globalThis.__contextChanges ?? []
              }
            }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'plugin.backend.whenReady', params: { pluginId: 'usage-context', backendPath, projectId: null } })
    await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 2, method: 'plugin.backend.whenReady', params: { pluginId: 'usage-context', backendPath, projectId: 'P-2', preserveActivation: true } })
    const response = await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 3, method: 'usage-context.snapshot', params: { pluginId: 'usage-context', backendPath, projectId: 'P-2', command: 'snapshot' } })

    expect(response).toMatchObject({ result: {
      context: { pluginId: 'usage-context', projectId: 'P-2' },
      activations: 1,
      starts: 1,
      stops: 0,
      contextChanges: ['P-2'],
    } })

    await runtime.deactivateBackend('usage-context')
    expect((globalThis as typeof globalThis & { __contextStops?: number }).__contextStops).toBe(1)
  })

  it('imports changed backend methods after deactivation without restarting the plugin host', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('beforeReload', {
            handler() { return 'before' }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    await expect(runtime.invokeBackend({ pluginId: 'reloadable', backendPath, command: 'beforeReload' })).resolves.toBe('before')

    await updateBackendModule(backendPath, `
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('afterReload', {
            handler() { return 'after' }
          }))
        }
      }
    `)
    await runtime.deactivateBackend('reloadable')

    await expect(runtime.invokeBackend({ pluginId: 'reloadable', backendPath, command: 'afterReload' })).resolves.toBe('after')
    await expect(runtime.invokeBackend({ pluginId: 'reloadable', command: 'beforeReload' })).rejects.toThrow(/not found/i)
  })

  it('evicts dependencies loaded before a failed backend evaluation so repaired files can activate', async () => {
    const backendPath = await writeBackendModule(`
      export default { activate() {} }
    `)
    const dependencyPath = join(dirname(backendPath), 'activation-dependency.cjs')
    await writeCommonJsModule(dependencyPath, "module.exports = { value: 'before-repair' }")
    await writeCommonJsModule(backendPath, `
      require('./activation-dependency.cjs')
      throw new Error('broken backend artifact')
    `)
    const runtime = createPluginHostRuntime()

    await expectOnlyPluginHostStderr([
      '[plugin:repairable-loader] activation error: broken backend artifact',
    ], async () => {
      await expect(runtime.activateBackend({ pluginId: 'repairable-loader', backendPath }))
        .rejects.toThrow('broken backend artifact')
    })

    await writeCommonJsModule(dependencyPath, "module.exports = { value: 'after-repair' }")
    await updateBackendModule(backendPath, `
      export default {
        async activate(openforge, context) {
          const dependency = require('./activation-dependency.cjs')
          context.subscriptions.add(openforge.backend.registerMethod('value', {
            handler() { return dependency.value }
          }))
        }
      }
    `)

    await expect(runtime.invokeBackend({ pluginId: 'repairable-loader', backendPath, command: 'value' }))
      .resolves.toBe('after-repair')
    await runtime.deactivateBackend('repairable-loader')
  })

  it('releases prior backend modules across repeated activate, deactivate, and reload cycles', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          let lazyModule
          context.subscriptions.add(openforge.backend.registerMethod('generation', {
            handler() {
              lazyModule ??= require('./lazy.cjs')
              return lazyModule.generation
            }
          }))
        }
      }
    `)
    const lazyModulePath = join(dirname(backendPath), 'lazy.cjs')
    const runtime = createPluginHostRuntime()
    const globals = globalThis as typeof globalThis & {
      __backendReloadMarkers?: Array<WeakRef<object>>
    }
    globals.__backendReloadMarkers = []

    for (let generation = 1; generation <= 20; generation += 1) {
      await writeCommonJsModule(lazyModulePath, `
        const marker = { generation: ${generation}, retained: new Uint8Array(512 * 1024) }
        globalThis.__backendReloadMarkers.push(new WeakRef(marker))
        module.exports = { generation: marker.generation, marker }
      `)

      await runtime.activateBackend({ pluginId: 'bounded-reload', backendPath })
      await expect(runtime.invokeBackend({ pluginId: 'bounded-reload', command: 'generation' })).resolves.toBe(generation)
      await runtime.deactivateBackend('bounded-reload')
    }

    setFlagsFromString('--expose-gc')
    try {
      const collectGarbage = runInNewContext('gc') as () => void
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise<void>(resolve => setImmediate(resolve))
        collectGarbage()
      }

      const retainedModules = globals.__backendReloadMarkers.filter(marker => marker.deref() !== undefined)
      expect(retainedModules).toHaveLength(0)
    } finally {
      setFlagsFromString('--no-expose-gc')
      delete globals.__backendReloadMarkers
    }
  })

  it('clears the crash-loop guard during explicit reload so repaired commands are discoverable', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.commands.register({
            id: 'get-handoff-notes',
            title: 'Get handoff notes',
            handler() { return { notes: [] } }
          }))
          context.subscriptions.add(openforge.commands.register({
            id: 'get-handoff-notes',
            title: 'Get handoff notes again',
            handler() { return { notes: [] } }
          }))
        }
      }
    `)
    const pluginId = 'com.openforge.handoff-notes-workflow'
    const runtime = createPluginHostRuntime({ crashLoopLimit: 1 })

    await expectOnlyPluginHostStderr([
      `[plugin:${pluginId}] activation error: Duplicate command id: ${pluginId}.get-handoff-notes`,
    ], async () => {
      await expect(runtime.activateBackend({ pluginId, backendPath, projectId: 'KVG' }))
        .rejects.toThrow(`Duplicate command id: ${pluginId}.get-handoff-notes`)
    })
    expect(await runtime.getBackendState(pluginId)).toMatchObject({
      state: 'error',
      crashLoopGuardTripped: true,
    })

    await updateBackendModule(backendPath, `
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.commands.register({
            id: 'get-handoff-notes',
            title: 'Get handoff notes',
            agent: { description: 'Get handoff notes for a task.' },
            handler() { return { notes: [] } }
          }))
        }
      }
    `)
    await runtime.deactivateBackend(pluginId)

    await expect(runtime.listAgentCommands({ pluginId, backendPath, projectId: 'KVG' })).resolves.toEqual([
      expect.objectContaining({ qualifiedId: `${pluginId}.get-handoff-notes` }),
    ])
    expect(await runtime.getBackendState(pluginId)).toMatchObject({
      state: 'ready',
      crashLoopGuardTripped: false,
    })
  })

  it('continues deactivation cleanup when a subscription disposable throws', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(() => { globalThis.__disposeEvents = [...(globalThis.__disposeEvents ?? []), 'after'] })
          context.subscriptions.add(() => { throw new Error('dispose boom') })
          context.subscriptions.add(() => { globalThis.__disposeEvents = [...(globalThis.__disposeEvents ?? []), 'before'] })
          context.subscriptions.add(openforge.backend.registerMethod('ok', { handler() { return true } }))
        }
      }
    `)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const runtime = createPluginHostRuntime()

    expect(await runtime.invokeBackend({ pluginId: 'cleanup', backendPath, command: 'ok' })).toBe(true)
    await expect(runtime.deactivateBackend('cleanup')).resolves.toMatchObject({ state: 'missing' })

    expect((globalThis as typeof globalThis & { __disposeEvents?: string[] }).__disposeEvents).toEqual(['before', 'after'])
    expect(await runtime.getBackendState('cleanup')).toMatchObject({ state: 'missing', ready: false })
    expect(stderr.mock.calls.map(call => String(call[0])).join('')).toContain('[plugin:cleanup] subscription dispose error: dispose boom')
    stderr.mockRestore()
  })

  it('accounts activation crashes when cleanup disposables throw during rollback', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(() => { throw new Error('dispose rollback boom') })
          context.subscriptions.add(openforge.background.register({
            id: 'crasher',
            scope: 'global',
            start() { throw new Error('service crash') }
          }))
        }
      }
    `)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const runtime = createPluginHostRuntime({ crashLoopLimit: 2 })

    await expect(runtime.activateBackend({ pluginId: 'rollback', backendPath })).rejects.toThrow(/service crash/)
    await expect(runtime.activateBackend({ pluginId: 'rollback', backendPath })).rejects.toThrow(/service crash/)
    await expect(runtime.activateBackend({ pluginId: 'rollback', backendPath })).rejects.toThrow(/crash-loop guard/i)
    expect(await runtime.getBackendState('rollback')).toMatchObject({ state: 'error', crashLoopGuardTripped: true })
    expect(stderr.mock.calls.map(call => String(call[0])).join('')).toContain('[plugin:rollback] subscription dispose error: dispose rollback boom')
    stderr.mockRestore()
  })

  it('reactivates enabled backend plugins after host restart', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          globalThis.__restartActivation = (globalThis.__restartActivation ?? 0) + 1
          context.subscriptions.add(openforge.backend.registerMethod('count', {
            handler() { return { count: globalThis.__restartActivation } }
          }))
        }
      }
    `)

    expect(await createPluginHostRuntime().invokeBackend({ pluginId: 'reactive', backendPath, command: 'count' })).toEqual({ count: 1 })
    expect(await createPluginHostRuntime().invokeBackend({ pluginId: 'reactive', backendPath, command: 'count' })).toEqual({ count: 2 })
  })

  it('guards against repeated activation/service crash loops', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          globalThis.__crashAttempts = (globalThis.__crashAttempts ?? 0) + 1
          context.subscriptions.add(openforge.background.register({
            id: 'crasher',
            scope: 'global',
            start() { throw new Error('service crash ' + globalThis.__crashAttempts) }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime({ crashLoopLimit: 2 })

    await expectOnlyPluginHostStderr([
      '[plugin:crashy] background service start error in crashy.crasher: service crash 1',
      '[plugin:crashy] activation error: service crash 1',
      '[plugin:crashy] background service start error in crashy.crasher: service crash 2',
      '[plugin:crashy] activation error: service crash 2',
    ], async () => {
      await expect(runtime.activateBackend({ pluginId: 'crashy', backendPath })).rejects.toThrow(/service crash 1/)
      await expect(runtime.activateBackend({ pluginId: 'crashy', backendPath })).rejects.toThrow(/service crash 2/)
      await expect(runtime.activateBackend({ pluginId: 'crashy', backendPath })).rejects.toThrow(/crash-loop guard/i)
      expect(await runtime.getBackendState('crashy')).toMatchObject({ state: 'error', crashLoopGuardTripped: true })
    })
  })

  it('allows activation again after the crash-loop window expires', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          globalThis.__expiringCrashAttempts = (globalThis.__expiringCrashAttempts ?? 0) + 1
          if (globalThis.__expiringCrashAttempts <= 2) {
            throw new Error('expiring crash ' + globalThis.__expiringCrashAttempts)
          }
          context.subscriptions.add(openforge.backend.registerMethod('ping', { handler() { return 'pong' } }))
        }
      }
    `)
    const runtime = createPluginHostRuntime({ crashLoopLimit: 2, crashLoopWindowMs: 1_000 })
    const now = vi.spyOn(Date, 'now').mockReturnValue(0)

    try {
      await expectOnlyPluginHostStderr([
        '[plugin:expiring] activation error: expiring crash 1',
        '[plugin:expiring] activation error: expiring crash 2',
      ], async () => {
        await expect(runtime.activateBackend({ pluginId: 'expiring', backendPath })).rejects.toThrow('expiring crash 1')
        await expect(runtime.activateBackend({ pluginId: 'expiring', backendPath })).rejects.toThrow('expiring crash 2')
        await expect(runtime.activateBackend({ pluginId: 'expiring', backendPath })).rejects.toThrow(/crash-loop guard/i)
      })

      expect(await runtime.getBackendState('expiring')).toMatchObject({
        state: 'error',
        error: 'expiring crash 2',
        crashLoopGuardTripped: true,
      })

      now.mockReturnValue(1_001)

      expect(await runtime.getBackendState('expiring')).toMatchObject({
        state: 'error',
        error: 'expiring crash 2',
        crashLoopGuardTripped: false,
      })

      await expect(runtime.activateBackend({ pluginId: 'expiring', backendPath })).resolves.toMatchObject({
        state: 'ready',
        error: null,
        crashLoopGuardTripped: false,
      })
    } finally {
      now.mockRestore()
    }
  })

  it('resets the crash-loop guard when the backend is explicitly deactivated', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          globalThis.__resetCrashAttempts = (globalThis.__resetCrashAttempts ?? 0) + 1
          if (globalThis.__resetCrashAttempts <= 2) {
            throw new Error('reset crash ' + globalThis.__resetCrashAttempts)
          }
          context.subscriptions.add(openforge.backend.registerMethod('ping', { handler() { return 'pong' } }))
        }
      }
    `)
    const runtime = createPluginHostRuntime({ crashLoopLimit: 2 })

    await expectOnlyPluginHostStderr([
      '[plugin:resettable] activation error: reset crash 1',
      '[plugin:resettable] activation error: reset crash 2',
    ], async () => {
      await expect(runtime.activateBackend({ pluginId: 'resettable', backendPath })).rejects.toThrow('reset crash 1')
      await expect(runtime.activateBackend({ pluginId: 'resettable', backendPath })).rejects.toThrow('reset crash 2')
    })

    await expect(runtime.deactivateBackend('resettable')).resolves.toMatchObject({
      state: 'missing',
      error: null,
      crashLoopGuardTripped: false,
    })
    await expect(runtime.activateBackend({ pluginId: 'resettable', backendPath })).resolves.toMatchObject({
      state: 'ready',
      crashLoopGuardTripped: false,
    })
  })

  it('reports bounded process memory and plugin lifecycle attribution without plugin payloads', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('echo', {
            handler(payload) { return payload }
          }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    await runtime.activateBackend({ pluginId: 'attributed', backendPath })
    const activeResponse = await runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 41,
      method: 'plugin.host.diagnostics',
    })

    expect(activeResponse).toEqual({
      jsonrpc: '2.0',
      id: 41,
      result: {
        memoryUsage: {
          rssBytes: expect.any(Number),
          heapTotalBytes: expect.any(Number),
          heapUsedBytes: expect.any(Number),
          externalBytes: expect.any(Number),
          arrayBuffersBytes: expect.any(Number),
        },
        plugins: [{
          pluginId: 'attributed',
          state: 'ready',
          active: true,
          activationCount: 1,
          reloadCount: 0,
        }],
        pluginCount: 1,
        pluginsTruncated: false,
      },
    })

    await runtime.deactivateBackend('attributed')
    await runtime.activateBackend({ pluginId: 'attributed', backendPath })
    await runtime.deactivateBackend('attributed')

    const inactiveResponse = await runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 42,
      method: 'plugin.host.diagnostics',
    })

    expect(inactiveResponse).toMatchObject({
      result: {
        plugins: [{
          pluginId: 'attributed',
          state: 'missing',
          active: false,
          activationCount: 2,
          reloadCount: 1,
        }],
      },
    })
    expect(JSON.stringify(inactiveResponse)).not.toContain('echo')

    for (let index = 0; index < 105; index += 1) {
      await runtime.getBackendState(`bounded-${String(index).padStart(3, '0')}`)
    }
    const boundedResponse = await runtime.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 43,
      method: 'plugin.host.diagnostics',
    })
    const diagnostics = boundedResponse.result as {
      plugins: unknown[]
      pluginCount: number
      pluginsTruncated: boolean
    }

    expect(diagnostics.plugins).toHaveLength(100)
    expect(diagnostics.pluginCount).toBe(106)
    expect(diagnostics.pluginsTruncated).toBe(true)
  })
})
