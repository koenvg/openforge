import { readFile } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { unicodeLineSeparatorFixturePath } from './backend-module.test-fixtures'
import { readJsonLines, StdioHostCallbackBridge, writeJsonRpcResponse } from './stdio-transport'

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

  it('keeps valid JSON with Unicode line separators in one LF-framed message', async () => {
    const input = new PassThrough()
    const lines: string[] = []
    const fixture = await readFile(unicodeLineSeparatorFixturePath, 'utf8')

    readJsonLines(input, line => lines.push(line))
    input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: fixture })}\n`)

    await new Promise<void>((resolve) => input.on('end', resolve))

    expect(lines).toEqual([JSON.stringify({ jsonrpc: '2.0', id: 1, result: fixture })])
  })
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

  it('propagates host callback errors and discards late duplicate responses', async () => {
    const stdout = captureStdout()
    const bridge = new StdioHostCallbackBridge()
    const result = bridge.request({ method: 'openforge.fs.external.readTextFile', params: {} })

    expect(bridge.handleResponse({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32603, message: 'failed to read UTF-8 text file' },
    })).toBe(true)
    await expect(result).rejects.toThrow('failed to read UTF-8 text file')
    expect(bridge.handleResponse({ jsonrpc: '2.0', id: 1, result: 'late' })).toBe(false)

    stdout.restore()
  })

  it('cancels a pending host callback and ignores its late response', async () => {
    const stdout = captureStdout()
    const bridge = new StdioHostCallbackBridge()
    const controller = new AbortController()
    const result = bridge.request(
      { method: 'openforge.fs.external.readTextFileChunk', params: {} },
      { signal: controller.signal },
    )

    controller.abort(new Error('read cancelled'))

    await expect(result).rejects.toThrow('read cancelled')
    expect(bridge.handleResponse({ jsonrpc: '2.0', id: 1, result: 'late' })).toBe(false)

    stdout.restore()
  })

  it('writes explicit null for successful void responses', () => {
    const stdout = captureStdout()

    writeJsonRpcResponse({ jsonrpc: '2.0', id: 7, result: undefined })

    expect(JSON.parse(stdout.output.join(''))).toEqual({ jsonrpc: '2.0', id: 7, result: null })
    stdout.restore()
  })
})
