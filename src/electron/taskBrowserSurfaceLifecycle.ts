import type { SidecarEventEnvelopeLike } from './sidecar.js'

export interface TaskBrowserSurfaceLifecycleOwner {
  destroyTask(taskId: string): void
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
