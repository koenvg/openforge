import {
  TaskBrowserSurfaceError,
} from './taskBrowserSurfaceManager.js'
import type {
  TaskBrowserBounds,
  TaskBrowserSurfaceErrorCode,
  TaskBrowserSurfaceManager,
} from './taskBrowserSurfaceManager.js'

const COMMANDS = new Set([
  'task_browser_surface_get_or_create',
  'task_browser_surface_attach',
  'task_browser_surface_detach',
  'task_browser_surface_destroy',
  'task_browser_surface_get_state',
  'task_browser_surface_navigate',
  'task_browser_surface_go_back',
  'task_browser_surface_go_forward',
  'task_browser_surface_reload',
  'task_browser_surface_stop',
  'task_browser_surface_reset_session',
  'task_browser_surface_destroy_plugin',
])

export type TaskBrowserSurfaceHostResponse<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code: TaskBrowserSurfaceErrorCode; message: string } }

export function isTaskBrowserSurfaceCommand(command: string): boolean {
  return COMMANDS.has(command)
}

function record(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser Surface command requires an object payload')
  }
  return payload as Record<string, unknown>
}

function stringField(payload: Record<string, unknown>, field: string): string {
  const value = payload[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TaskBrowserSurfaceError(field === 'taskId' ? 'INVALID_TASK' : 'INVALID_ID', `Task Browser Surface command requires ${field}`)
  }
  return value
}

function optionalStringField(payload: Record<string, unknown>, field: string): string | undefined {
  const value = payload[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new TaskBrowserSurfaceError('INVALID_URL', `Task Browser Surface ${field} must be a string`)
  return value
}

function attachmentGenerationField(payload: Record<string, unknown>): number {
  const value = payload.attachmentGeneration
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser Attachment requires a valid generation')
  }
  return value
}

function boundsField(payload: Record<string, unknown>): TaskBrowserBounds | null {
  const bounds = payload.bounds
  if (bounds === null) return null
  if (typeof bounds !== 'object' || Array.isArray(bounds)) {
    throw new TaskBrowserSurfaceError('INVALID_BOUNDS', 'Task Browser Attachment requires bounds or null')
  }
  const value = bounds as Record<string, unknown>
  if (![value.x, value.y, value.width, value.height].every(entry => typeof entry === 'number' && Number.isFinite(entry))) {
    throw new TaskBrowserSurfaceError('INVALID_BOUNDS', 'Task Browser Attachment bounds must contain finite numbers')
  }
  return {
    x: value.x as number,
    y: value.y as number,
    width: value.width as number,
    height: value.height as number,
  }
}

function errorResponse(error: unknown): TaskBrowserSurfaceHostResponse<never> {
  if (error instanceof TaskBrowserSurfaceError) {
    return { ok: false, error: { code: error.code, message: error.message } }
  }
  return {
    ok: false,
    error: {
      code: 'HOST_UNAVAILABLE',
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

export class TaskBrowserSurfaceIpcRouter {
  constructor(private readonly manager: TaskBrowserSurfaceManager) {}

  async handle(command: string, rawPayload: unknown, windowId: number | null): Promise<TaskBrowserSurfaceHostResponse> {
    try {
      if (windowId === null) throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Task Browser Surface request has no owning OpenForge window')
      const payload = record(rawPayload)

      if (command === 'task_browser_surface_get_or_create') {
        const initialUrl = optionalStringField(payload, 'initialUrl')
        const request = {
          windowId,
          pluginId: stringField(payload, 'pluginId'),
          taskId: stringField(payload, 'taskId'),
          id: stringField(payload, 'id'),
          ...(initialUrl === undefined ? {} : { initialUrl }),
        }
        return { ok: true, value: await this.manager.getOrCreate(request) }
      }

      if (command === 'task_browser_surface_reset_session') {
        this.manager.assertWindowRegistered(windowId)
        await this.manager.resetSession(stringField(payload, 'pluginId'))
        return { ok: true, value: undefined }
      }

      if (command === 'task_browser_surface_destroy_plugin') {
        this.manager.assertWindowRegistered(windowId)
        this.manager.destroyPlugin(stringField(payload, 'pluginId'))
        return { ok: true, value: undefined }
      }

      const surfaceId = stringField(payload, 'surfaceId')
      this.manager.assertWindowOwnsSurface(surfaceId, windowId)
      switch (command) {
        case 'task_browser_surface_attach':
          this.manager.attach(
            surfaceId,
            stringField(payload, 'attachmentId'),
            attachmentGenerationField(payload),
            boundsField(payload),
          )
          return { ok: true, value: undefined }
        case 'task_browser_surface_detach': {
          const attachmentId = optionalStringField(payload, 'attachmentId')
          this.manager.detach(
            surfaceId,
            attachmentId,
            attachmentId === undefined ? undefined : attachmentGenerationField(payload),
          )
          return { ok: true, value: undefined }
        }
        case 'task_browser_surface_destroy':
          await this.manager.destroy(surfaceId)
          return { ok: true, value: undefined }
        case 'task_browser_surface_get_state':
          return { ok: true, value: await this.manager.getState(surfaceId) }
        case 'task_browser_surface_navigate':
          return { ok: true, value: await this.manager.navigate(surfaceId, stringField(payload, 'url')) }
        case 'task_browser_surface_go_back':
          return { ok: true, value: await this.manager.goBack(surfaceId) }
        case 'task_browser_surface_go_forward':
          return { ok: true, value: await this.manager.goForward(surfaceId) }
        case 'task_browser_surface_reload':
          return { ok: true, value: await this.manager.reload(surfaceId) }
        case 'task_browser_surface_stop':
          return { ok: true, value: await this.manager.stop(surfaceId) }
        default:
          throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', `Unknown Task Browser Surface command: ${command}`)
      }
    } catch (error) {
      return errorResponse(error)
    }
  }
}
