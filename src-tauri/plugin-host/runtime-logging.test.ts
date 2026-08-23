import { describe, expect, it, vi } from 'vitest'
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
