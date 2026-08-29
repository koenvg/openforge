import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import type {
  BackendStateSnapshot,
  HostCallbackHandler,
  HostCallbackOptions,
  HostCallbackRequest,
  JsonRpcRequest,
  JsonRpcResponse,
  PluginHostProcessDiagnostics,
} from './runtime-types'

const PLUGIN_WORKER_ROLE = 'openforge-plugin-backend'

type WorkerRuntime = {
  handleJsonRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse>
}

type ParentRequestMessage = {
  type: 'rpc'
  requestId: number
  request: JsonRpcRequest
}

type ParentCallbackResultMessage = {
  type: 'host-callback-result'
  callbackId: number
  result?: unknown
  error?: string
}

type ParentCallbackCancelMessage = {
  type: 'host-callback-cancel'
  callbackId: number
}

type WorkerResponseMessage = {
  type: 'rpc-result'
  requestId: number
  response: JsonRpcResponse
}

type WorkerCallbackMessage = {
  type: 'host-callback'
  callbackId: number
  request: HostCallbackRequest
}

type ParentMessage = ParentRequestMessage | ParentCallbackResultMessage | ParentCallbackCancelMessage
type WorkerMessage = WorkerResponseMessage | WorkerCallbackMessage | ParentCallbackCancelMessage

type PendingCallback = {
  resolve(value: unknown): void
  reject(error: Error): void
  removeAbortListener(): void
}

type PendingRequest = {
  resolve(response: JsonRpcResponse): void
  reject(error: Error): void
}

function errorResponse(request: JsonRpcRequest, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: request.id, error: { code: -32603, message } }
}

function missingSnapshot(pluginId: string): BackendStateSnapshot {
  return {
    pluginId,
    state: 'missing',
    ready: false,
    error: null,
    methods: [],
    backgroundServices: [],
    crashLoopGuardTripped: false,
  }
}

export function isPluginBackendWorker(): boolean {
  return !isMainThread
    && typeof workerData === 'object'
    && workerData !== null
    && (workerData as { role?: unknown }).role === PLUGIN_WORKER_ROLE
}

export function startPluginBackendWorker(createRuntime: (hostCallbacks: HostCallbackHandler) => WorkerRuntime): void {
  if (!parentPort) throw new Error('Plugin backend worker requires a parent message port')

  let callbackSequence = 0
  const pendingCallbacks = new Map<number, PendingCallback>()
  const hostCallbacks: HostCallbackHandler = (request, options) => {
    const callbackId = ++callbackSequence
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        parentPort.postMessage({ type: 'host-callback-cancel', callbackId } satisfies ParentCallbackCancelMessage)
        pendingCallbacks.delete(callbackId)
        reject(options?.signal?.reason instanceof Error ? options.signal.reason : new Error('Plugin host callback aborted'))
      }
      options?.signal?.addEventListener('abort', onAbort, { once: true })
      pendingCallbacks.set(callbackId, {
        resolve,
        reject,
        removeAbortListener: () => options?.signal?.removeEventListener('abort', onAbort),
      })
      parentPort.postMessage({ type: 'host-callback', callbackId, request } satisfies WorkerCallbackMessage)
    })
  }
  const runtime = createRuntime(hostCallbacks)

  parentPort.on('message', (message: ParentMessage) => {
    if (message.type === 'host-callback-result') {
      const pending = pendingCallbacks.get(message.callbackId)
      if (!pending) return
      pendingCallbacks.delete(message.callbackId)
      pending.removeAbortListener()
      if (message.error !== undefined) pending.reject(new Error(message.error))
      else pending.resolve(message.result)
      return
    }
    if (message.type !== 'rpc') return
    void runtime.handleJsonRpcRequest(message.request).then(
      response => parentPort.postMessage({ type: 'rpc-result', requestId: message.requestId, response } satisfies WorkerResponseMessage),
      error => parentPort.postMessage({
        type: 'rpc-result',
        requestId: message.requestId,
        response: errorResponse(message.request, error instanceof Error ? error.message : String(error)),
      } satisfies WorkerResponseMessage),
    )
  })
}

class PluginWorkerHandle {
  private readonly worker: Worker
  private readonly pendingRequests = new Map<number, PendingRequest>()
  private readonly callbackControllers = new Map<number, AbortController>()
  private requestSequence = 0
  private stopped = false

  constructor(
    entrypointUrl: string,
    readonly pluginId: string,
    private readonly hostCallbacks: HostCallbackHandler,
    private readonly onStopped: (worker: PluginWorkerHandle) => void,
  ) {
    this.worker = new Worker(new URL(entrypointUrl), {
      workerData: { role: PLUGIN_WORKER_ROLE },
    })
    this.worker.on('message', (message: WorkerMessage) => this.handleMessage(message))
    this.worker.on('error', error => this.stop(error))
    this.worker.on('exit', code => this.stop(new Error(`Plugin ${pluginId} backend worker exited with code ${code}`)))
  }

  request(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (this.stopped) return Promise.reject(new Error(`Plugin ${this.pluginId} backend worker is stopped`))
    const requestId = ++this.requestSequence
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject })
      this.worker.postMessage({ type: 'rpc', requestId, request } satisfies ParentRequestMessage)
    })
  }

  async terminate(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    try {
      await this.worker.terminate()
    } finally {
      this.rejectPending(new Error(`Plugin ${this.pluginId} backend worker terminated`))
    }
  }

  private handleMessage(message: WorkerMessage): void {
    if (message.type === 'rpc-result') {
      const pending = this.pendingRequests.get(message.requestId)
      if (!pending) return
      this.pendingRequests.delete(message.requestId)
      pending.resolve(message.response)
      return
    }

    if (message.type === 'host-callback-cancel') {
      this.callbackControllers.get(message.callbackId)?.abort(new Error('Plugin host callback aborted'))
      this.callbackControllers.delete(message.callbackId)
      return
    }

    const controller = new AbortController()
    this.callbackControllers.set(message.callbackId, controller)
    void Promise.resolve(this.hostCallbacks(message.request, { signal: controller.signal })).then(
      result => this.postCallbackResult(message.callbackId, { result }),
      error => this.postCallbackResult(message.callbackId, { error: error instanceof Error ? error.message : String(error) }),
    )
  }

  private postCallbackResult(callbackId: number, outcome: { result?: unknown; error?: string }): void {
    this.callbackControllers.delete(callbackId)
    if (this.stopped) return
    this.worker.postMessage({ type: 'host-callback-result', callbackId, ...outcome } satisfies ParentCallbackResultMessage)
  }

  private stop(error: Error): void {
    if (this.stopped) return
    this.stopped = true
    this.rejectPending(error)
    this.onStopped(this)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) pending.reject(error)
    this.pendingRequests.clear()
    for (const controller of this.callbackControllers.values()) controller.abort(error)
    this.callbackControllers.clear()
  }
}

export class IsolatedPluginHostRuntime {
  private readonly workers = new Map<string, PluginWorkerHandle>()

  constructor(
    private readonly entrypointUrl: string,
    private readonly hostCallbacks: HostCallbackHandler,
  ) {}

  async handleJsonRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (request.jsonrpc !== '2.0' || typeof request.id !== 'number') {
      return { jsonrpc: '2.0', id: request.id, error: { code: -32600, message: 'Invalid request' } }
    }
    if (request.method === 'plugin.host.diagnostics') {
      try {
        return await this.diagnostics(request)
      } catch (error) {
        return errorResponse(request, error instanceof Error ? error.message : String(error))
      }
    }

    const pluginId = request.params?.pluginId
    if (typeof pluginId !== 'string' || pluginId.trim().length === 0) {
      return { jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'Missing pluginId' } }
    }

    if (request.method === 'plugin.backend.state' && !this.workers.has(pluginId)) {
      return { jsonrpc: '2.0', id: request.id, result: missingSnapshot(pluginId) }
    }
    if (request.method === 'plugin.backend.deactivate') {
      return await this.deactivate(request, pluginId)
    }

    try {
      return await this.worker(pluginId).request(request)
    } catch (error) {
      return errorResponse(request, error instanceof Error ? error.message : String(error))
    }
  }

  private worker(pluginId: string): PluginWorkerHandle {
    let worker = this.workers.get(pluginId)
    if (!worker) {
      worker = new PluginWorkerHandle(
        this.entrypointUrl,
        pluginId,
        (request, options) => this.handleWorkerCallback(request, options),
        stoppedWorker => {
          if (this.workers.get(pluginId) === stoppedWorker) this.workers.delete(pluginId)
        },
      )
      this.workers.set(pluginId, worker)
    }
    return worker
  }

  private async handleWorkerCallback(
    request: HostCallbackRequest,
    options?: HostCallbackOptions,
  ): Promise<unknown> {
    if (request.method === 'openforge.plugins.listCommands') {
      const sourcePluginId = request.params.sourcePluginId
      const responses = await Promise.all([...this.workers.entries()]
        .filter(([pluginId]) => pluginId !== sourcePluginId)
        .map(([, worker]) => worker.request({
          jsonrpc: '2.0',
          id: 0,
          method: 'plugin.internal.listCommands',
          params: { pluginId: worker.pluginId },
        })))
      const failed = responses.find(response => response.error)
      if (failed?.error) throw new Error(failed.error.message)
      return responses.flatMap(response => Array.isArray(response.result) ? response.result : [])
    }

    if (request.method === 'openforge.plugins.emitGlobalEvent') {
      const event = request.params.event
      const sourcePluginId = request.params.sourcePluginId
      if (typeof event !== 'string') throw new Error('Cross-plugin event emission requires an event')
      const responses = await Promise.all([...this.workers.entries()]
        .filter(([pluginId]) => pluginId !== sourcePluginId)
        .map(([, worker]) => worker.request({
          jsonrpc: '2.0',
          id: 0,
          method: 'plugin.internal.emitGlobalEvent',
          params: { pluginId: worker.pluginId, event, payload: request.params.payload },
        })))
      const failed = responses.find(response => response.error)
      if (failed?.error) throw new Error(failed.error.message)
      return undefined
    }

    if (request.method !== 'openforge.plugins.invokeGlobalCommand') {
      return await this.hostCallbacks(request, options)
    }

    const qualifiedId = request.params.qualifiedId
    if (typeof qualifiedId !== 'string') throw new Error('Cross-plugin command invocation requires a qualifiedId')
    const targetPluginId = [...this.workers.keys()]
      .filter(pluginId => qualifiedId.startsWith(`${pluginId}.`))
      .sort((left, right) => right.length - left.length)[0]
    if (!targetPluginId) throw new Error(`Command not found: ${qualifiedId}`)

    const response = await this.worker(targetPluginId).request({
      jsonrpc: '2.0',
      id: 0,
      method: 'plugin.internal.invokeGlobalCommand',
      params: {
        pluginId: targetPluginId,
        qualifiedId,
        payload: request.params.payload,
        callerPluginId: request.params.callerPluginId,
      },
    })
    if (response.error) throw new Error(response.error.message)
    return response.result
  }


  private async deactivate(request: JsonRpcRequest, pluginId: string): Promise<JsonRpcResponse> {
    const worker = this.workers.get(pluginId)
    if (!worker) return { jsonrpc: '2.0', id: request.id, result: missingSnapshot(pluginId) }
    try {
      return await worker.request(request)
    } catch (error) {
      return errorResponse(request, error instanceof Error ? error.message : String(error))
    } finally {
      this.workers.delete(pluginId)
      await worker.terminate()
    }
  }

  private async diagnostics(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const responses = await Promise.all([...this.workers.values()].map(worker => worker.request(request)))
    const plugins = responses.flatMap(response => {
      const diagnostics = response.result as PluginHostProcessDiagnostics | undefined
      return diagnostics?.plugins ?? []
    })
    const memoryUsage = process.memoryUsage()
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        memoryUsage: {
          rssBytes: memoryUsage.rss,
          heapTotalBytes: memoryUsage.heapTotal,
          heapUsedBytes: memoryUsage.heapUsed,
          externalBytes: memoryUsage.external,
          arrayBuffersBytes: memoryUsage.arrayBuffers,
        },
        plugins,
        pluginCount: plugins.length,
        pluginsTruncated: responses.some(response => {
          const diagnostics = response.result as PluginHostProcessDiagnostics | undefined
          return diagnostics?.pluginsTruncated === true
        }),
      } satisfies PluginHostProcessDiagnostics,
    }
  }
}
