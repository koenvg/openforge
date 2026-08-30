import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import { buildBackendPluginHostRuntime } from '../../scripts/electron-build.mjs'
import type { JsonRpcRequest, JsonRpcResponse } from './runtime-types'

const DEFAULT_RESPONSE_TIMEOUT_MS = 2_000
const FORCE_KILL_TIMEOUT_MS = 1_000

export type BuiltPluginHostMessage = JsonRpcRequest | JsonRpcResponse
type JsonRpcMessage = BuiltPluginHostMessage
type MessageListener = (message: JsonRpcMessage) => void

type PendingResponse = {
  resolve(response: JsonRpcResponse): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
}

type StderrWaiter = {
  predicate(stderr: string): boolean
  resolve(): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
}

function isJsonRpcResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return 'result' in message || 'error' in message
}

function requestId(request: JsonRpcRequest): number {
  if (typeof request.id !== 'number') throw new Error('Built plugin-host requests require a numeric id')
  return request.id
}

export class BuiltPluginHostTestHarness {
  readonly stdoutLines: string[] = []

  private stderrWritten = ''
  private readonly pendingResponses = new Map<number, PendingResponse>()
  private readonly messageListeners = new Set<MessageListener>()
  private readonly stderrWaiters = new Set<StderrWaiter>()
  private stopped = false

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly lines: Interface,
    private readonly hostOutDir: string,
  ) {
    child.stderr.on('data', this.handleStderr)
    child.once('error', this.handleProcessError)
    child.once('exit', this.handleExit)
    lines.on('line', this.handleStdoutLine)
  }

  static async start(): Promise<BuiltPluginHostTestHarness> {
    const hostOutDir = await mkdtemp(join(tmpdir(), 'openforge-built-plugin-host-'))
    try {
      const hostPath = await realpath(await buildBackendPluginHostRuntime(process.cwd(), hostOutDir))
      const child = spawn(process.execPath, [hostPath], { stdio: ['pipe', 'pipe', 'pipe'] })
      const lines = createInterface({ input: child.stdout })
      return new BuiltPluginHostTestHarness(child, lines, hostOutDir)
    } catch (error) {
      await rm(hostOutDir, { recursive: true, force: true })
      throw error
    }
  }

  get stderr(): string {
    return this.stderrWritten
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  send(message: JsonRpcMessage): void {
    if (this.stopped || !this.child.stdin.writable) throw new Error('Built plugin host is not running')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  request(request: JsonRpcRequest, description = `JSON-RPC response ${String(request.id)}`): Promise<JsonRpcResponse> {
    const id = requestId(request)
    if (this.pendingResponses.has(id)) throw new Error(`A built plugin-host request with id ${id} is already pending`)

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(id)
        reject(new Error(`Timed out waiting for ${description}: ${this.stderrWritten}`))
      }, DEFAULT_RESPONSE_TIMEOUT_MS)
      this.pendingResponses.set(id, { resolve, reject, timeout })

      try {
        this.send(request)
      } catch (error) {
        clearTimeout(timeout)
        this.pendingResponses.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  waitForStderr(predicate: (stderr: string) => boolean, description: string): Promise<void> {
    if (predicate(this.stderrWritten)) return Promise.resolve()

    return new Promise<void>((resolve, reject) => {
      const waiter: StderrWaiter = {
        predicate,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.stderrWaiters.delete(waiter)
          reject(new Error(`Timed out waiting for ${description}: ${this.stderrWritten}`))
        }, DEFAULT_RESPONSE_TIMEOUT_MS),
      }
      this.stderrWaiters.add(waiter)
    })
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.lines.close()
    this.failPending(new Error(`Plugin host stopped: ${this.stderrWritten}`))

    try {
      await this.terminateChild()
    } finally {
      this.child.stderr.off('data', this.handleStderr)
      this.child.off('error', this.handleProcessError)
      this.child.off('exit', this.handleExit)
      await rm(this.hostOutDir, { recursive: true, force: true })
    }
  }

  private readonly handleStdoutLine = (line: string): void => {
    this.stdoutLines.push(line)
    let message: JsonRpcMessage
    try {
      message = JSON.parse(line) as JsonRpcMessage
    } catch {
      return
    }

    for (const listener of this.messageListeners) listener(message)

    if (!isJsonRpcResponse(message) || typeof message.id !== 'number') return
    const pending = this.pendingResponses.get(message.id)
    if (!pending) return
    clearTimeout(pending.timeout)
    this.pendingResponses.delete(message.id)
    pending.resolve(message)
  }

  private readonly handleStderr = (chunk: Buffer | string): void => {
    this.stderrWritten += String(chunk)
    for (const waiter of [...this.stderrWaiters]) {
      if (!waiter.predicate(this.stderrWritten)) continue
      clearTimeout(waiter.timeout)
      this.stderrWaiters.delete(waiter)
      waiter.resolve()
    }
  }

  private readonly handleProcessError = (error: Error): void => {
    this.failPending(error)
  }

  private readonly handleExit = (code: number | null): void => {
    if (this.stopped) return
    this.failPending(new Error(`Plugin host exited with code ${code}: ${this.stderrWritten}`))
  }

  private failPending(error: Error): void {
    for (const pending of this.pendingResponses.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pendingResponses.clear()

    for (const waiter of this.stderrWaiters) {
      clearTimeout(waiter.timeout)
      waiter.reject(error)
    }
    this.stderrWaiters.clear()
  }

  private async terminateChild(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return

    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => this.child.kill('SIGKILL'), FORCE_KILL_TIMEOUT_MS)
      this.child.once('exit', () => {
        clearTimeout(forceKill)
        resolve()
      })
      this.child.kill()
    })
  }
}
