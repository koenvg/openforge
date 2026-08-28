import type { Readable } from 'node:stream'
import type { HostCallbackHandler, HostCallbackOptions, JsonRpcId, JsonRpcRequest, JsonRpcResponse } from './runtime-types'

type PendingHostCallback = {
  resolve(value: unknown): void
  reject(error: Error): void
  removeAbortListener(): void
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Host callback cancelled')
}

export class StdioHostCallbackBridge {
  private nextId = 1
  private readonly pending = new Map<number, PendingHostCallback>()

  request: HostCallbackHandler = ({ method, params }, options?: HostCallbackOptions) => {
    options?.signal?.throwIfAborted()
    const id = this.nextId++
    const message = { jsonrpc: '2.0', id, method, params }

    return new Promise<unknown>((resolve, reject) => {
      const onAbort = (): void => {
        if (!this.pending.delete(id)) return
        removeAbortListener()
        reject(abortReason(options!.signal!))
      }
      const removeAbortListener = (): void => options?.signal?.removeEventListener('abort', onAbort)
      options?.signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, { resolve, reject, removeAbortListener })

      try {
        process.stdout.write(`${JSON.stringify(message)}\n`)
      } catch (error) {
        this.pending.delete(id)
        removeAbortListener()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  handleResponse(response: JsonRpcResponse): boolean {
    if (typeof response.id !== 'number') return false
    const pending = this.pending.get(response.id)
    if (!pending) return false
    this.pending.delete(response.id)
    pending.removeAbortListener()
    if (response.error) {
      pending.reject(new Error(response.error.message))
      return true
    }
    pending.resolve(response.result)
    return true
  }
}

// Electron's Node readline treats U+2028 and U+2029 as line endings even though JSON permits
// both unescaped. The plugin-host protocol is LF-framed, so split only on LF.
export function readJsonLines(input: Readable, handleLine: (line: string) => void): void {
  let buffer = ''

  const emitLine = (line: string): void => {
    handleLine(line.endsWith('\r') ? line.slice(0, -1) : line)
  }

  input.setEncoding('utf8')
  input.on('data', (chunk: string) => {
    buffer += chunk
    let lineEnd = buffer.indexOf('\n')
    while (lineEnd !== -1) {
      emitLine(buffer.slice(0, lineEnd))
      buffer = buffer.slice(lineEnd + 1)
      lineEnd = buffer.indexOf('\n')
    }
  })
  input.on('end', () => {
    if (buffer.length > 0) emitLine(buffer)
  })
}

function isJsonRpcResponse(value: JsonRpcRequest | JsonRpcResponse): value is JsonRpcResponse {
  return 'result' in value || 'error' in value
}

function respond(id: JsonRpcId, body: Omit<JsonRpcResponse, 'jsonrpc' | 'id'>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...body })}\n`)
}

export function writeJsonRpcResponse(response: JsonRpcResponse): void {
  if (response.error) {
    respond(response.id, { error: response.error })
    return
  }
  // JSON.stringify drops undefined. Emit null so every successful request can be
  // matched to a response by the sidecar.
  respond(response.id, { result: response.result ?? null })
}

export type StdioServerOptions = {
  callbackBridge: StdioHostCallbackBridge
  handleRequest(request: JsonRpcRequest): Promise<void>
}

export function startStdioServer(options: StdioServerOptions): void {
  readJsonLines(process.stdin, (line) => {
    if (!line.trim()) return

    let message: JsonRpcRequest | JsonRpcResponse
    try {
      message = JSON.parse(line) as JsonRpcRequest | JsonRpcResponse
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message } })}\n`)
      return
    }

    if (isJsonRpcResponse(message) && options.callbackBridge.handleResponse(message)) return

    void options.handleRequest(message as JsonRpcRequest).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`[plugin_host] request handling error: ${message}\n`)
    })
  })

  process.stdin.on('close', () => {
    process.exit(0)
  })
}
