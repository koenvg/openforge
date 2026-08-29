import { spawn } from 'node:child_process'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { describe, expect, it, vi } from 'vitest'
import { buildBackendPluginHostRuntime } from '../../scripts/electron-build.mjs'
import { createPluginHostRuntime } from './index'
import { writeBackendModule } from './backend-module.test-fixtures'

describe('plugin-host backend logging', () => {
  it('tags plugin activation and handler logs/errors with plugin id', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          console.log('activating')
          context.subscriptions.add(openforge.backend.registerMethod('fail', {
            handler() {
              console.error('handler failed')
              throw new Error('boom')
            }
          }))
        }
      }
    `)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const runtime = createPluginHostRuntime()

    await expect(runtime.invokeBackend({ pluginId: 'logger', backendPath, command: 'fail' })).rejects.toThrow(/boom/)

    const written = stderr.mock.calls.map(call => String(call[0])).join('')
    expect(written).toContain('[plugin:logger] activating')
    expect(written).toContain('[plugin:logger] handler failed')
    expect(written).toContain('[plugin:logger] handler error in logger.fail: boom')
    stderr.mockRestore()
  })

  it('keeps detached activation logs off stdout and attributed to their plugin', async () => {
    const hostOutDir = await mkdtemp(join(tmpdir(), 'openforge-built-plugin-host-logging-'))
    const hostPath = await realpath(await buildBackendPluginHostRuntime(process.cwd(), hostOutDir))
    const backendPath = await writeBackendModule(`
      export default {
        async activate() {
          setTimeout(() => {
            console.info({ detachedRefreshMarker: true })
            console.dir({ detachedDirMarker: true })
          }, 25)
        }
      }
    `)
    const child = spawn(process.execPath, [hostPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = createInterface({ input: child.stdout })
    const stdoutLines: string[] = []
    let stderrWritten = ''

    const activationResponse = new Promise<Record<string, unknown>>((resolve, reject) => {
      const responseTimeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for plugin activation: ${stderrWritten}`))
      }, 2_000)
      lines.on('line', (line) => {
        stdoutLines.push(line)
        try {
          const message = JSON.parse(line) as Record<string, unknown>
          if (message.id === 1) {
            clearTimeout(responseTimeout)
            resolve(message)
          }
        } catch {
          // Assert the complete stdout stream after the detached log has fired.
        }
      })
    })
    const detachedLog = new Promise<void>((resolve, reject) => {
      const logTimeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for detached plugin log: ${stderrWritten}`))
      }, 2_000)
      child.stderr.on('data', (chunk) => {
        stderrWritten += String(chunk)
        if (stderrWritten.includes('detachedRefreshMarker') && stderrWritten.includes('detachedDirMarker')) {
          clearTimeout(logTimeout)
          resolve()
        }
      })
    })

    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'plugin.backend.activate',
      params: { pluginId: 'timer-logger', backendPath },
    })}\n`)

    try {
      await expect(activationResponse).resolves.toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: { pluginId: 'timer-logger', ready: true },
      })
      await expect(detachedLog).resolves.toBeUndefined()
      expect(stdoutLines.map(line => JSON.parse(line))).toHaveLength(1)
      expect(stderrWritten).toContain('[plugin:timer-logger] {"detachedRefreshMarker":true}')
      expect(stderrWritten.split('\n').some(line =>
        line.startsWith('[plugin:timer-logger] ') && line.includes('detachedDirMarker'),
      )).toBe(true)
    } finally {
      lines.close()
      child.kill()
    }
  })
  it('keeps plugin log attribution isolated for overlapping JSON-RPC backend calls', async () => {
    const backendPath = await writeBackendModule(`
      export default {
        async activate(openforge, context) {
          context.subscriptions.add(openforge.backend.registerMethod('run', {
            async handler(input) {
              console.log(context.pluginId + ':start')
              await new Promise(resolve => setTimeout(resolve, input.delayMs))
              console.log(context.pluginId + ':end')
              return context.pluginId
            }
          }))
        }
      }
    `)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const runtime = createPluginHostRuntime()

    await Promise.all([
      runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'plugin.backend.invoke', params: { pluginId: 'alpha', backendPath, command: 'run', payload: { delayMs: 0 } } }),
      runtime.handleJsonRpcRequest({ jsonrpc: '2.0', id: 2, method: 'plugin.backend.invoke', params: { pluginId: 'beta', backendPath, command: 'run', payload: { delayMs: 20 } } }),
    ])

    const written = stderr.mock.calls.map(call => String(call[0])).join('')
    expect(written).toContain('[plugin:alpha] alpha:start')
    expect(written).toContain('[plugin:alpha] alpha:end')
    expect(written).toContain('[plugin:beta] beta:start')
    expect(written).toContain('[plugin:beta] beta:end')
    expect(written).not.toContain('[plugin:beta] alpha:end')
    expect(written.split('\n').filter(Boolean).every(line => line.startsWith('[plugin:'))).toBe(true)
    stderr.mockRestore()
  })
})
