import { randomUUID } from 'node:crypto'
import { RestartWorkspaceCoordinator } from './restartWorkspaceCoordinator.js'
import { parseRestartWindowWorkspace } from './restartWorkspaceValidation.js'
import type { RestartWindowWorkspace } from './restartWorkspace.js'
import type { ShutdownIntent } from './restartOperation.js'
import type { RestartWorkspaceStore } from './restartWorkspaceStore.js'

interface RestartLifecycle {
  prepare(operationId: string): Promise<void>
  cancel(operationId: string): Promise<void>
  validateCompletion(): Promise<void>
  complete(operationId: string): Promise<void>
  shutdownIntent(): Promise<ShutdownIntent>
}

type PendingCapture = {
  operationId: string
  resolve(snapshot: RestartWindowWorkspace): void
  reject(error: Error): void
}

/** Only registered app renderers participate; native IDs never enter the durable record. */
export class RestartWorkspaceIpc {
  private readonly coordinator: RestartWorkspaceCoordinator
  private readonly windows = new Map<number, string>()
  private readonly pending = new Map<number, PendingCapture>()
  private captureOperation: string | null = null

  constructor(
    private readonly store: RestartWorkspaceStore,
    private readonly launchOperation: string | null,
    private readonly replace: (operationId: string, assertCurrent: () => void) => Promise<void>,
    private readonly lifecycle?: RestartLifecycle,
  ) {
    this.coordinator = new RestartWorkspaceCoordinator(store)
  }

  shutdownIntent(): Promise<ShutdownIntent> {
    return this.lifecycle?.shutdownIntent() ?? Promise.resolve('quit')
  }

  async launchWindowIds(initialWindowCount: 1 | 2 = 1): Promise<string[]> {
    const record = this.launchOperation ? await this.store.load(this.launchOperation) : null
    return record?.windows.filter(window => !record.restoredWindowIds.includes(window.windowId)).map(window => window.windowId)
      ?? Array.from({ length: initialWindowCount }, () => randomUUID())
  }

  register(rendererId: number, windowId: string, requestCapture: (operationId: string) => void): () => void {
    if (this.windows.has(rendererId)) throw new Error('Renderer already registered')
    const unregister = this.coordinator.register(windowId, async () => {
      const operationId = this.captureOperation
      if (!operationId) throw new Error('No workspace capture requested')
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await new Promise<RestartWindowWorkspace>((resolve, reject) => {
          this.pending.set(rendererId, { operationId, resolve, reject })
          timer = setTimeout(() => reject(new Error('Workspace capture timed out; restart cancelled')), 10_000)
          requestCapture(operationId)
        })
      } finally {
        clearTimeout(timer)
        this.pending.delete(rendererId)
      }
    })
    this.windows.set(rendererId, windowId)
    return () => {
      unregister()
      this.windows.delete(rendererId)
      this.pending.get(rendererId)?.reject(new Error('Window closed during workspace capture'))
    }
  }

  async handle(rendererId: number, command: string, payload: unknown): Promise<unknown> {
    const windowId = this.windows.get(rendererId)
    if (!windowId) throw new Error('Unregistered restart workspace renderer')
    const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    switch (command) {
      case 'restart_app':
      case 'controlled_restart': {
        if (this.captureOperation) throw new Error('Controlled restart already preparing')
        const operationId = randomUUID()
        this.captureOperation = operationId
        try {
          await this.lifecycle?.prepare(operationId)
          await this.coordinator.restart(operationId, assertCurrent => this.replace(operationId, assertCurrent))
        } catch (error) {
          await this.lifecycle?.cancel(operationId)
          this.captureOperation = null
          throw error
        } finally {
          for (const pending of this.pending.values()) pending.reject(new Error('Workspace capture cancelled'))
        }
        return
      }
      case 'capture_restart_workspace': {
        const pending = this.pending.get(rendererId)
        if (!pending || input.operationId !== pending.operationId) throw new Error('Stale workspace capture')
        const snapshot = parseRestartWindowWorkspace({ ...(input.snapshot as object), windowId })
        pending.resolve(snapshot)
        return
      }
      case 'get_restart_workspace': {
        if (!this.launchOperation) return null
        const record = await this.store.load(this.launchOperation)
        if (!record && await this.store.allWindowsAcknowledged(this.launchOperation)) {
          await this.lifecycle?.validateCompletion()
          await this.lifecycle?.complete(this.launchOperation)
        }
        const window = record?.windows.find(window => window.windowId === windowId)
        return window && !record?.restoredWindowIds.includes(windowId) ? { operationId: this.launchOperation, window } : null
      }
      case 'complete_restart_workspace':
        if (input.operationId !== this.launchOperation) throw new Error('Stale workspace completion')
        await this.lifecycle?.validateCompletion()
        await this.store.completeWindow(this.launchOperation!, windowId)
        if (!await this.store.load(this.launchOperation!)) await this.lifecycle?.complete(this.launchOperation!)
        return
      default:
        throw new Error(`Unknown restart workspace command: ${command}`)
    }
  }
}
