import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { unicodeLineSeparatorFixturePath, writeBackendModule } from './backend-module.test-fixtures'
import { BuiltPluginHostTestHarness } from './built-plugin-host.test-harness'
import { createPluginHostRuntime } from './index'

describe('plugin-host JSON-RPC and stdio transport', () => {
  it('services independent stdio requests concurrently', async () => {
    const blockingBackendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('block', {
            async handler() {
              await new Promise(resolve => setTimeout(resolve, 200))
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
    const host = await BuiltPluginHostTestHarness.start()
    const responseIds: number[] = []
    host.onMessage((response) => {
      if (response.id === 1 || response.id === 2) responseIds.push(response.id)
    })

    try {
      await Promise.all([
        host.request({
          jsonrpc: '2.0',
          id: 1,
          method: 'blocking.block',
          params: { pluginId: 'blocking', backendPath: blockingBackendPath, command: 'block' },
        }, 'blocking plugin response'),
        host.request({
          jsonrpc: '2.0',
          id: 2,
          method: 'plugin.backend.whenReady',
          params: { pluginId: 'ready', backendPath: readyBackendPath },
        }, 'ready plugin response'),
      ])
      expect(responseIds).toEqual([2, 1])
    } finally {
      await host.stop()
    }
  })


  it('runs ESM backends in replaceable per-plugin workers', async () => {
    const pluginDirectory = await mkdtemp(join(tmpdir(), 'openforge-esm-backend-'))
    const backendPath = join(pluginDirectory, 'backend.mjs')
    const writeBackend = async (generation: number) => {
      await writeFile(backendPath, `
        import { threadId } from 'node:worker_threads'
        export default {
          activate(openforge, context) {
            context.subscriptions.add(openforge.backend.registerMethod('generation', {
              handler() { return { generation: ${generation}, threadId } }
            }))
          }
        }
      `)
    }
    await writeBackend(1)

    const host = await BuiltPluginHostTestHarness.start()

    try {
      const first = await host.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'esm-worker.generation',
        params: { pluginId: 'esm-worker', backendPath, command: 'generation' },
      })
      expect(first.error).toBeUndefined()
      expect(first.result).toMatchObject({ generation: 1, threadId: expect.any(Number) })
      expect((first.result as { threadId: number }).threadId).toBeGreaterThan(0)
      await expect(host.request({ jsonrpc: '2.0', id: 20, method: 'plugin.host.diagnostics', params: {} })).resolves.toMatchObject({
        result: {
          pluginCount: 1,
          plugins: [expect.objectContaining({ pluginId: 'esm-worker', active: true })],
        },
      })

      await expect(host.request({
        jsonrpc: '2.0', id: 2, method: 'plugin.backend.deactivate', params: { pluginId: 'esm-worker' },
      }))
        .resolves.toMatchObject({ result: { state: 'missing', ready: false } })
      await writeBackend(2)

      const second = await host.request({
        jsonrpc: '2.0',
        id: 3,
        method: 'esm-worker.generation',
        params: { pluginId: 'esm-worker', backendPath, command: 'generation' },
      })
      expect(second.error).toBeUndefined()
      expect(second.result).toMatchObject({ generation: 2, threadId: expect.any(Number) })
      expect((second.result as { threadId: number }).threadId)
        .not.toBe((first.result as { threadId: number }).threadId)
    } finally {
      await host.stop()
    }
  })

  it('routes global commands and events between isolated plugin workers', async () => {
    const targetBackendPath = join(await mkdtemp(join(tmpdir(), 'openforge-target-backend-')), 'backend.mjs')
    const sourceBackendPath = join(await mkdtemp(join(tmpdir(), 'openforge-source-backend-')), 'backend.mjs')
    await writeFile(targetBackendPath, `
      const received = []
      export default {
        activate(openforge, context) {
          context.subscriptions.add(openforge.commands.register({
            id: 'echo', title: 'Echo', handler(payload) { return { echoed: payload } }
          }))
          context.subscriptions.add(openforge.events.onGlobal('shared.event', payload => received.push(payload)))
          context.subscriptions.add(openforge.backend.registerMethod('receivedEvents', {
            handler() { return received }
          }))
        }
      }
    `)
    await writeFile(sourceBackendPath, `
      export default {
        activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('callTarget', {
            handler(payload) { return openforge.commands.invokeGlobal('target.echo', payload) }
          }))
          context.subscriptions.add(openforge.backend.registerMethod('emitGlobal', {
            handler(payload) { return openforge.events.emitGlobal('shared.event', payload) }
          }))
          context.subscriptions.add(openforge.backend.registerMethod('listCommands', {
            handler() { return openforge.commands.list() }
          }))
        }
      }
    `)

    const host = await BuiltPluginHostTestHarness.start()

    try {
      await expect(host.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'plugin.backend.whenReady',
        params: { pluginId: 'target', backendPath: targetBackendPath },
      })).resolves.toMatchObject({ result: { state: 'ready' } })
      await expect(host.request({
        jsonrpc: '2.0',
        id: 2,
        method: 'source.callTarget',
        params: {
          pluginId: 'source', backendPath: sourceBackendPath, command: 'callTarget', payload: 'across-workers',
        },
      })).resolves.toMatchObject({ result: { echoed: 'across-workers' } })
      await expect(host.request({
        jsonrpc: '2.0',
        id: 3,
        method: 'source.emitGlobal',
        params: {
          pluginId: 'source', backendPath: sourceBackendPath, command: 'emitGlobal', payload: 'broadcast',
        },
      })).resolves.toMatchObject({ result: null })
      await expect(host.request({
        jsonrpc: '2.0',
        id: 4,
        method: 'target.receivedEvents',
        params: { pluginId: 'target', backendPath: targetBackendPath, command: 'receivedEvents' },
      })).resolves.toMatchObject({ result: ['broadcast'] })
      const listed = await host.request({
        jsonrpc: '2.0',
        id: 5,
        method: 'source.listCommands',
        params: { pluginId: 'source', backendPath: sourceBackendPath, command: 'listCommands' },
      })
      expect(listed.result).toEqual(expect.arrayContaining([
        expect.objectContaining({ qualifiedId: 'target.echo' }),
      ]))
    } finally {
      await host.stop()
    }
  })
  it('completes external text reads and propagates errors through the built stdio host', async () => {
    const fixture = await readFile(unicodeLineSeparatorFixturePath, 'utf8')
    const fixtureBytes = Buffer.byteLength(fixture)
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('read', {
            async handler(input) {
              if (input.fail) {
                return await openforge.fs.external.readTextFile({ root: '/tmp', path: 'error.jsonl' })
              }
              const whole = await openforge.fs.external.readTextFile({ root: '/tmp', path: 'fixture.jsonl' })
              let streamed = ''
              for await (const chunk of openforge.fs.external.readTextFileChunks({
                root: '/tmp',
                path: 'fixture.jsonl'
              })) {
                streamed += chunk
              }
              return {
                wholeBytes: Buffer.byteLength(whole),
                streamedBytes: Buffer.byteLength(streamed),
                same: whole === streamed
              }
            }
          }))
        }
      }
    `)
    const host = await BuiltPluginHostTestHarness.start()
    const stopHandlingHostRequests = host.onMessage((message) => {
      if (!('method' in message)) return
      if (message.method === 'openforge.fs.external.readTextFile') {
        const response = message.params?.path === 'error.jsonl'
          ? { jsonrpc: '2.0' as const, id: message.id, error: { code: -32603, message: 'fixture read failed' } }
          : { jsonrpc: '2.0' as const, id: message.id, result: fixture }
        host.send(response)
        return
      }
      if (message.method === 'openforge.fs.external.readTextFileChunk') {
        host.send({
          jsonrpc: '2.0',
          id: message.id,
          result: { content: fixture, nextOffset: fixtureBytes, eof: true },
        })
      }
    })

    try {
      const [completedRead, failedRead] = await Promise.all([
        host.request({
          jsonrpc: '2.0',
          id: 101,
          method: 'fixture-reader.read',
          params: { pluginId: 'fixture-reader', backendPath, command: 'read', payload: { fail: false } },
        }, 'successful external text response'),
        host.request({
          jsonrpc: '2.0',
          id: 102,
          method: 'fixture-reader.read',
          params: { pluginId: 'fixture-reader', backendPath, command: 'read', payload: { fail: true } },
        }, 'failed external text response'),
      ])
      expect(completedRead.result).toEqual({
        wholeBytes: fixtureBytes,
        streamedBytes: fixtureBytes,
        same: true,
      })
      expect(failedRead.error?.message).toBe('fixture read failed')
    } finally {
      stopHandlingHostRequests()
      await host.stop()
    }
  })
  it('exposes backend readiness through explicit JSON-RPC state and whenReady methods without hijacking dotted plugin methods', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('ping', { handler() { return 'pong' } }))
          context.subscriptions.add(openforge.backend.registerMethod('sync.backend.state', { handler() { return 'plugin state handler' } }))
          context.subscriptions.add(openforge.backend.registerMethod('sync.backend.whenReady', { handler() { return 'plugin whenReady handler' } }))
        }
      }
    `)
    const runtime = createPluginHostRuntime()

    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'plugin.backend.state', params: { pluginId: 'ready' } })).toMatchObject({ jsonrpc: '2.0', id: 1, result: { state: 'missing', ready: false } })
    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 2, method: 'plugin.backend.whenReady', params: { pluginId: 'ready', backendPath } })).toMatchObject({ jsonrpc: '2.0', id: 2, result: { state: 'ready', ready: true } })
    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 3, method: 'ready.sync.backend.state', params: { pluginId: 'ready', backendPath, command: 'sync.backend.state' } })).toMatchObject({ jsonrpc: '2.0', id: 3, result: 'plugin state handler' })
    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 4, method: 'ready.sync.backend.whenReady', params: { pluginId: 'ready', backendPath, command: 'sync.backend.whenReady' } })).toMatchObject({ jsonrpc: '2.0', id: 4, result: 'plugin whenReady handler' })
    expect(await runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 5, method: 'ready.ping', params: { pluginId: 'ready', backendPath, command: 'ping' } })).toMatchObject({ jsonrpc: '2.0', id: 5, result: 'pong' })
  })
})
