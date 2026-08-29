import { spawn } from 'node:child_process'
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { describe, expect, it } from 'vitest'
import { buildBackendPluginHostRuntime } from '../../scripts/electron-build.mjs'
import { createPluginHostRuntime } from './index'
import { unicodeLineSeparatorFixturePath, writeBackendModule } from './backend-module.test-fixtures'

describe('plugin-host JSON-RPC and stdio transport', () => {
  it('services independent stdio requests concurrently', async () => {
    const hostOutDir = await mkdtemp(join(tmpdir(), 'openforge-built-plugin-host-'))
    const builtHostPath = await buildBackendPluginHostRuntime(process.cwd(), hostOutDir)
    const hostPath = await realpath(builtHostPath)
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
    const child = spawn(process.execPath, [hostPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = createInterface({ input: child.stdout })
    const stderr: string[] = []
    child.stderr.on('data', chunk => stderr.push(String(chunk)))

    const responseIds = new Promise<number[]>((resolve, reject) => {
      const ids: number[] = []
      const responseTimeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for plugin-host responses: ${stderr.join('')}`))
      }, 2_000)
      lines.on('line', (line) => {
        const response = JSON.parse(line) as { id?: number }
        if (response.id !== 1 && response.id !== 2) return
        ids.push(response.id)
        if (ids.length === 2) {
          clearTimeout(responseTimeout)
          resolve(ids)
        }
      })
      child.once('exit', (code) => {
        if (ids.length < 2) {
          clearTimeout(responseTimeout)
          reject(new Error(`Plugin host exited with code ${code}: ${stderr.join('')}`))
        }
      })
    })

    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'blocking.block',
      params: { pluginId: 'blocking', backendPath: blockingBackendPath, command: 'block' },
    })}\n`)
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'plugin.backend.whenReady',
      params: { pluginId: 'ready', backendPath: readyBackendPath },
    })}\n`)

    try {
      await expect(responseIds).resolves.toEqual([2, 1])
    } finally {
      lines.close()
      child.kill()
    }
  })


  it('runs ESM backends in replaceable per-plugin workers', async () => {
    const hostOutDir = await mkdtemp(join(tmpdir(), 'openforge-built-plugin-host-worker-'))
    const hostPath = await realpath(await buildBackendPluginHostRuntime(process.cwd(), hostOutDir))
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

    const child = spawn(process.execPath, [hostPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = createInterface({ input: child.stdout })
    const stderr: string[] = []
    const pending = new Map<number, {
      resolve: (response: { result?: unknown; error?: { message: string } }) => void
      reject: (error: Error) => void
    }>()
    child.stderr.on('data', chunk => stderr.push(String(chunk)))
    lines.on('line', (line) => {
      const response = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } }
      if (typeof response.id !== 'number') return
      pending.get(response.id)?.resolve(response)
      pending.delete(response.id)
    })

    const request = (id: number, method: string, params: Record<string, unknown>) => new Promise<{
      result?: unknown
      error?: { message: string }
    }>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })

    try {
      const first = await request(1, 'esm-worker.generation', {
        pluginId: 'esm-worker', backendPath, command: 'generation',
      })
      expect(first.error).toBeUndefined()
      expect(first.result).toMatchObject({ generation: 1, threadId: expect.any(Number) })
      expect((first.result as { threadId: number }).threadId).toBeGreaterThan(0)
      await expect(request(20, 'plugin.host.diagnostics', {})).resolves.toMatchObject({
        result: {
          pluginCount: 1,
          plugins: [expect.objectContaining({ pluginId: 'esm-worker', active: true })],
        },
      })

      await expect(request(2, 'plugin.backend.deactivate', { pluginId: 'esm-worker' }))
        .resolves.toMatchObject({ result: { state: 'missing', ready: false } })
      await writeBackend(2)

      const second = await request(3, 'esm-worker.generation', {
        pluginId: 'esm-worker', backendPath, command: 'generation',
      })
      expect(second.error).toBeUndefined()
      expect(second.result).toMatchObject({ generation: 2, threadId: expect.any(Number) })
      expect((second.result as { threadId: number }).threadId)
        .not.toBe((first.result as { threadId: number }).threadId)
    } finally {
      for (const { reject } of pending.values()) reject(new Error(`Plugin host stopped: ${stderr.join('')}`))
      pending.clear()
      lines.close()
      child.kill()
    }
  })

  it('routes global commands and events between isolated plugin workers', async () => {
    const hostOutDir = await mkdtemp(join(tmpdir(), 'openforge-built-plugin-host-cross-worker-'))
    const hostPath = await realpath(await buildBackendPluginHostRuntime(process.cwd(), hostOutDir))
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

    const child = spawn(process.execPath, [hostPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = createInterface({ input: child.stdout })
    const responses = new Map<number, (response: { result?: unknown; error?: { message: string } }) => void>()
    lines.on('line', line => {
      const response = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } }
      if (typeof response.id !== 'number') return
      responses.get(response.id)?.(response)
      responses.delete(response.id)
    })
    const request = (id: number, method: string, params: Record<string, unknown>) => new Promise<{
      result?: unknown
      error?: { message: string }
    }>(resolve => {
      responses.set(id, resolve)
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })

    try {
      await expect(request(1, 'plugin.backend.whenReady', { pluginId: 'target', backendPath: targetBackendPath }))
        .resolves.toMatchObject({ result: { state: 'ready' } })
      await expect(request(2, 'source.callTarget', {
        pluginId: 'source', backendPath: sourceBackendPath, command: 'callTarget', payload: 'across-workers',
      })).resolves.toMatchObject({ result: { echoed: 'across-workers' } })
      await expect(request(3, 'source.emitGlobal', {
        pluginId: 'source', backendPath: sourceBackendPath, command: 'emitGlobal', payload: 'broadcast',
      })).resolves.toMatchObject({ result: null })
      await expect(request(4, 'target.receivedEvents', {
        pluginId: 'target', backendPath: targetBackendPath, command: 'receivedEvents',
      })).resolves.toMatchObject({ result: ['broadcast'] })
      const listed = await request(5, 'source.listCommands', {
        pluginId: 'source', backendPath: sourceBackendPath, command: 'listCommands',
      })
      expect(listed.result).toEqual(expect.arrayContaining([
        expect.objectContaining({ qualifiedId: 'target.echo' }),
      ]))
    } finally {
      lines.close()
      child.kill()
    }
  })
  it('completes external text reads and propagates errors through the built stdio host', async () => {
    const hostOutDir = await mkdtemp(join(tmpdir(), 'openforge-built-plugin-host-fs-'))
    const hostPath = await realpath(await buildBackendPluginHostRuntime(process.cwd(), hostOutDir))
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
    const child = spawn(process.execPath, [hostPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = createInterface({ input: child.stdout })
    const stderr: string[] = []
    child.stderr.on('data', chunk => stderr.push(String(chunk)))

    const responses = new Promise<Map<number, { result?: unknown; error?: { message: string } }>>((resolve, reject) => {
      const completed = new Map<number, { result?: unknown; error?: { message: string } }>()
      const responseTimeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for external text responses: ${stderr.join('')}`))
      }, 2_000)

      lines.on('line', (line) => {
        const message = JSON.parse(line) as {
          id?: number
          method?: string
          params?: { path?: string }
          result?: unknown
          error?: { message: string }
        }
        if (message.method === 'openforge.fs.external.readTextFile') {
          const response = message.params?.path === 'error.jsonl'
            ? { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'fixture read failed' } }
            : { jsonrpc: '2.0', id: message.id, result: fixture }
          child.stdin.write(`${JSON.stringify(response)}\n`)
          return
        }
        if (message.method === 'openforge.fs.external.readTextFileChunk') {
          child.stdin.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: { content: fixture, nextOffset: fixtureBytes, eof: true },
          })}\n`)
          return
        }
        if (message.id !== 101 && message.id !== 102) return
        completed.set(message.id, { result: message.result, error: message.error })
        if (completed.size === 2) {
          clearTimeout(responseTimeout)
          resolve(completed)
        }
      })
      child.once('exit', (code) => {
        if (completed.size < 2) {
          clearTimeout(responseTimeout)
          reject(new Error(`Plugin host exited with code ${code}: ${stderr.join('')}`))
        }
      })
    })

    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 101,
      method: 'fixture-reader.read',
      params: { pluginId: 'fixture-reader', backendPath, command: 'read', payload: { fail: false } },
    })}\n`)
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 102,
      method: 'fixture-reader.read',
      params: { pluginId: 'fixture-reader', backendPath, command: 'read', payload: { fail: true } },
    })}\n`)

    try {
      const completed = await responses
      expect(completed.get(101)?.result).toEqual({
        wholeBytes: fixtureBytes,
        streamedBytes: fixtureBytes,
        same: true,
      })
      expect(completed.get(102)?.error?.message).toBe('fixture read failed')
    } finally {
      lines.close()
      child.kill()
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
