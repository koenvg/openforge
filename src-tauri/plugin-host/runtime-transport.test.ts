import { spawn } from 'node:child_process'
import { mkdtemp, readFile, realpath } from 'node:fs/promises'
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
