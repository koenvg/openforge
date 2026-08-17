import { afterEach, describe, expect, it, vi } from 'vitest'
import { StdioHostCallbackBridge, writeJsonRpcResponse } from './stdio-transport'

function captureStdout(): { output: string[]; restore(): void } {
  const output: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output.push(String(chunk))
    return true
  })
  return { output, restore: () => spy.mockRestore() }
}

describe('plugin-host stdio transport', () => {
  afterEach(() => vi.restoreAllMocks())

  it('correlates host callback responses with outbound JSON-RPC requests', async () => {
    const stdout = captureStdout()
    const bridge = new StdioHostCallbackBridge()

    const result = bridge.request({ method: 'openforge.tasks.get', params: { taskId: 'T-1' } })

    expect(JSON.parse(stdout.output.join(''))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'openforge.tasks.get',
      params: { taskId: 'T-1' },
    })
    expect(bridge.handleResponse({ jsonrpc: '2.0', id: 1, result: { id: 'T-1' } })).toBe(true)
    await expect(result).resolves.toEqual({ id: 'T-1' })
    expect(bridge.handleResponse({ jsonrpc: '2.0', id: 99, result: null })).toBe(false)

    stdout.restore()
  })

  it('writes explicit null for successful void responses', () => {
    const stdout = captureStdout()

    writeJsonRpcResponse({ jsonrpc: '2.0', id: 7, result: undefined })

    expect(JSON.parse(stdout.output.join(''))).toEqual({ jsonrpc: '2.0', id: 7, result: null })
    stdout.restore()
  })
})
