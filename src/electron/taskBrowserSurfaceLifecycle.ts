import type { SidecarEventEnvelopeLike } from './sidecar.js'

export interface TaskBrowserSurfaceLifecycleOwner {
  destroyTask(taskId: string): void
}

export interface TaskBrowserSurfaceLifecycleIdentity {
  windowId: number
  pluginId: string
  taskId: string
}

export interface TaskBrowserSurfaceLifecycleEpoch {
  global: number
  plugin: number
  task: number
  session: number
  window: number
}

export class TaskBrowserSurfaceLifecycle {
  private readonly pluginEpochs = new Map<string, number>()
  private readonly taskEpochs = new Map<string, number>()
  private readonly sessionEpochs = new Map<string, number>()
  private readonly windowEpochs = new Map<number, number>()
  private readonly sessionResets = new Map<string, Promise<void>>()
  private globalEpoch = 0

  capture(identity: TaskBrowserSurfaceLifecycleIdentity): TaskBrowserSurfaceLifecycleEpoch {
    return {
      global: this.globalEpoch,
      plugin: this.pluginEpochs.get(identity.pluginId) ?? 0,
      task: this.taskEpochs.get(identity.taskId) ?? 0,
      session: this.sessionEpochs.get(identity.pluginId) ?? 0,
      window: this.windowEpochs.get(identity.windowId) ?? 0,
    }
  }

  isCurrent(
    identity: TaskBrowserSurfaceLifecycleIdentity,
    epoch: TaskBrowserSurfaceLifecycleEpoch,
  ): boolean {
    const current = this.capture(identity)
    return epoch.global === current.global
      && epoch.plugin === current.plugin
      && epoch.task === current.task
      && epoch.session === current.session
      && epoch.window === current.window
  }

  invalidateWindow(windowId: number): void {
    this.windowEpochs.set(windowId, (this.windowEpochs.get(windowId) ?? 0) + 1)
  }

  invalidateTask(taskId: string): void {
    this.taskEpochs.set(taskId, (this.taskEpochs.get(taskId) ?? 0) + 1)
  }

  invalidatePlugin(pluginId: string): void {
    this.pluginEpochs.set(pluginId, (this.pluginEpochs.get(pluginId) ?? 0) + 1)
  }

  invalidateAll(): void {
    this.globalEpoch += 1
  }

  currentSessionEpoch(pluginId: string): number {
    return this.sessionEpochs.get(pluginId) ?? 0
  }

  async waitForSessionReset(pluginId: string): Promise<void> {
    let reset = this.sessionResets.get(pluginId)
    while (reset) {
      await reset.catch(() => undefined)
      reset = this.sessionResets.get(pluginId)
    }
  }

  async runSessionReset(
    pluginId: string,
    cleanup: () => Promise<void>,
  ): Promise<void> {
    this.sessionEpochs.set(pluginId, (this.sessionEpochs.get(pluginId) ?? 0) + 1)
    const previousReset = this.sessionResets.get(pluginId)
    const reset = (async () => {
      await previousReset?.catch(() => undefined)
      await cleanup()
    })()
    this.sessionResets.set(pluginId, reset)
    try {
      await reset
    } finally {
      if (this.sessionResets.get(pluginId) === reset) this.sessionResets.delete(pluginId)
    }
  }
}

export function handleTaskBrowserSurfaceLifecycleEvent(
  owner: TaskBrowserSurfaceLifecycleOwner,
  envelope: SidecarEventEnvelopeLike,
): void {
  if (envelope.eventName !== 'task-changed') return
  if (typeof envelope.payload !== 'object' || envelope.payload === null || Array.isArray(envelope.payload)) return

  const payload = envelope.payload as Record<string, unknown>
  if (payload.action !== 'deleted' || typeof payload.task_id !== 'string' || !payload.task_id.trim()) return

  owner.destroyTask(payload.task_id)
}
