import { createInterface } from 'node:readline'
import type { HostCallbackHandler, JsonRpcId, JsonRpcRequest, JsonRpcResponse } from './runtime-types'

export class StdioHostCallbackBridge {
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  request: HostCallbackHandler = ({ method, params }) => {
    const id = this.nextId++
    const message = { jsonrpc: '2.0', id, method, params }
    process.stdout.write(`${JSON.stringify(message)}\n`)
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  handleResponse(response: JsonRpcResponse): boolean {
    if (typeof response.id !== 'number') return false
    const pending = this.pending.get(response.id)
    if (!pending) return false
    this.pending.delete(response.id)
    if (response.error) {
      pending.reject(new Error(response.error.message))
      return true
    }
    pending.resolve(response.result)
    return true
  }
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
  const input = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })

  input.on('line', (line) => {
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

  input.on('close', () => {
    process.exit(0)
  })
}
