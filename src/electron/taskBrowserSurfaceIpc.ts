import {
  TaskBrowserSurfaceError,
} from './taskBrowserSurfaceManager.js'
import type {
  TaskBrowserBounds,
  TaskBrowserDevToolsPanel,
  TaskBrowserSurfaceErrorCode,
  TaskBrowserSurfaceManager,
  TaskBrowserSurfaceVisualFeedback,
  TaskBrowserVisualFeedbackPresentation,
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
  'task_browser_surface_open_devtools',
  'task_browser_surface_close_devtools',
  'task_browser_surface_select_visible_region',
  'task_browser_surface_cancel_visible_region_selection',
  'task_browser_surface_clear_visual_feedback',
  'task_browser_surface_replace_visual_feedback',
  'task_browser_surface_capture_exists',
  'task_browser_surface_capture_visible_viewport',
  'task_browser_surface_discard_capture',
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

function optionalDevToolsPanelField(payload: Record<string, unknown>): TaskBrowserDevToolsPanel | undefined {
  const value = payload.panel
  if (value === undefined) return undefined
  if (value !== 'elements' && value !== 'console') {
    throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser DevTools panel must be elements or console')
  }
  return value
}

function attachmentGenerationField(payload: Record<string, unknown>): number {
  const value = payload.attachmentGeneration
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser Attachment requires a valid generation')
  }
  return value
}

function surfaceGenerationField(payload: Record<string, unknown>): number {
  const value = payload.generation
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser Surface capture requires a valid generation')
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

function visualFeedbackField(payload: Record<string, unknown>): TaskBrowserSurfaceVisualFeedback[] {
  if (!Array.isArray(payload.feedback)) {
    throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser visual feedback requires an array')
  }
  const numbers = new Set<number>()
  return payload.feedback.map(entry => {
    const value = record(entry)
    const annotationNumber = value.annotationNumber
    if (typeof annotationNumber !== 'number' || !Number.isSafeInteger(annotationNumber) || annotationNumber <= 0 || numbers.has(annotationNumber)) {
      throw new TaskBrowserSurfaceError('INVALID_ID', 'Task Browser visual feedback requires unique positive annotation numbers')
    }
    numbers.add(annotationNumber)
    const url = stringField(value, 'url')
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      throw new TaskBrowserSurfaceError('INVALID_URL', 'Task Browser visual feedback requires a valid HTTP(S) URL')
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new TaskBrowserSurfaceError('INVALID_URL', 'Task Browser visual feedback requires a valid HTTP(S) URL')
    }
    const comment = stringField(value, 'comment').trim()
    const regionValue = value.region
    if (typeof regionValue !== 'object' || regionValue === null || Array.isArray(regionValue)) {
      throw new TaskBrowserSurfaceError('INVALID_BOUNDS', 'Task Browser visual feedback requires normalized marker geometry')
    }
    const region = regionValue as Record<string, unknown>
    const values = [region.x, region.y, region.width, region.height]
    if (!values.every(item => typeof item === 'number' && Number.isFinite(item))
      || (region.x as number) < 0 || (region.y as number) < 0
      || (region.width as number) <= 0 || (region.height as number) <= 0
      || (region.x as number) + (region.width as number) > 1
      || (region.y as number) + (region.height as number) > 1) {
      throw new TaskBrowserSurfaceError('INVALID_BOUNDS', 'Task Browser visual feedback geometry must stay within normalized bounds')
    }
    return {
      annotationNumber,
      url,
      comment,
      region: {
        x: region.x as number,
        y: region.y as number,
        width: region.width as number,
        height: region.height as number,
      },
    }
  })
}

function optionalVisualFeedbackPresentationField(
  payload: Record<string, unknown>,
): TaskBrowserVisualFeedbackPresentation | undefined {
  if (payload.presentation === undefined) return undefined
  const presentation = record(payload.presentation)
  if (presentation.appearance !== 'light' && presentation.appearance !== 'dark') {
    throw new TaskBrowserSurfaceError(
      'INVALID_ID',
      'Task Browser visual feedback appearance must be light or dark',
    )
  }
  return { appearance: presentation.appearance }
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

      if (
        command === 'task_browser_surface_select_visible_region'
        || command === 'task_browser_surface_cancel_visible_region_selection'
        || command === 'task_browser_surface_capture_visible_viewport'
        || command === 'task_browser_surface_clear_visual_feedback'
        || command === 'task_browser_surface_replace_visual_feedback'
        || command === 'task_browser_surface_capture_exists'
        || command === 'task_browser_surface_discard_capture'
      ) {
        const owner = {
          windowId,
          pluginId: stringField(payload, 'pluginId'),
          taskId: stringField(payload, 'taskId'),
          surfaceId: stringField(payload, 'surfaceId'),
          generation: surfaceGenerationField(payload),
        }
        if (command === 'task_browser_surface_select_visible_region') {
          return { ok: true, value: await this.manager.selectVisibleRegion(owner) }
        }
        if (command === 'task_browser_surface_cancel_visible_region_selection') {
          await this.manager.cancelVisibleRegionSelection(owner)
          return { ok: true, value: undefined }
        }
        if (command === 'task_browser_surface_clear_visual_feedback') {
          await this.manager.clearVisualFeedback(owner)
          return { ok: true, value: undefined }
        }
        if (command === 'task_browser_surface_replace_visual_feedback') {
          await this.manager.replaceVisualFeedback(
            owner,
            visualFeedbackField(payload),
            optionalVisualFeedbackPresentationField(payload),
          )
          return { ok: true, value: undefined }
        }
        if (command === 'task_browser_surface_capture_exists') {
          return { ok: true, value: await this.manager.captureExists({ ...owner, artifactId: stringField(payload, 'artifactId') }) }
        }
        if (command === 'task_browser_surface_capture_visible_viewport') {
          return { ok: true, value: await this.manager.captureVisibleViewport(owner) }
        }
        await this.manager.discardCapture({ ...owner, artifactId: stringField(payload, 'artifactId') })
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
        case 'task_browser_surface_open_devtools':
          return { ok: true, value: await this.manager.openDevTools(surfaceId, optionalDevToolsPanelField(payload)) }
        case 'task_browser_surface_close_devtools':
          return { ok: true, value: await this.manager.closeDevTools(surfaceId) }
        default:
          throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', `Unknown Task Browser Surface command: ${command}`)
      }
    } catch (error) {
      return errorResponse(error)
    }
  }
}
