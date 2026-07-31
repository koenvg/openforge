import { TaskBrowserSurfaceError } from './taskBrowserSurfaceManager.js'

export type InvokeTaskBrowserAuthorizationCommand = (command: string, payload: unknown) => Promise<unknown>

function projectIdFromTask(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const projectId = (value as Record<string, unknown>).project_id
  return typeof projectId === 'string' && projectId.trim() !== '' ? projectId : null
}

function taskStatusFromTask(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const status = (value as Record<string, unknown>).status
  return typeof status === 'string' && status.trim() !== '' ? status : null
}

function includesPlugin(value: unknown, pluginId: string): boolean {
  return Array.isArray(value) && value.some(entry => (
    typeof entry === 'object'
    && entry !== null
    && (entry as Record<string, unknown>).id === pluginId
  ))
}

/**
 * Authorizes plugin-wide operations that name no Task, such as a Plugin Browser Session reset. The
 * plugin must be installed; project enablement cannot apply because the operation spans projects.
 */
export function createPluginBrowserSessionAuthorizer(invoke: InvokeTaskBrowserAuthorizationCommand) {
  return async (pluginId: string): Promise<void> => {
    let plugins: unknown
    try {
      plugins = await invoke('list_plugins', {})
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', `Plugin Browser Session authorization is unavailable: ${message}`)
    }
    if (!includesPlugin(plugins, pluginId)) {
      throw new TaskBrowserSurfaceError('PLUGIN_NOT_ENABLED', `Plugin ${pluginId} is not installed`)
    }
  }
}

export function createTaskBrowserSurfaceAuthorizer(invoke: InvokeTaskBrowserAuthorizationCommand) {
  return async (pluginId: string, taskId: string): Promise<void> => {
    let task: unknown
    try {
      task = await invoke('get_task_detail', { taskId })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('sidecar') && message.includes('not available')) {
        throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', 'Task Browser Surface authorization host is unavailable')
      }
      throw new TaskBrowserSurfaceError('INVALID_TASK', `Task Browser Surface Task ${taskId} does not exist`)
    }

    const projectId = projectIdFromTask(task)
    if (!projectId) {
      throw new TaskBrowserSurfaceError('INVALID_TASK', `Task Browser Surface Task ${taskId} is not owned by a project`)
    }

    const taskStatus = taskStatusFromTask(task)
    if (!taskStatus || taskStatus === 'done') {
      throw new TaskBrowserSurfaceError('INVALID_TASK', `Task Browser Surface Task ${taskId} is not active`)
    }

    let enabledPlugins: unknown
    try {
      enabledPlugins = await invoke('get_enabled_plugins', { projectId })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new TaskBrowserSurfaceError('HOST_UNAVAILABLE', `Task Browser Surface project enablement is unavailable: ${message}`)
    }
    if (!includesPlugin(enabledPlugins, pluginId)) {
      throw new TaskBrowserSurfaceError('PLUGIN_NOT_ENABLED', `Plugin ${pluginId} is not enabled for Task ${taskId}'s project`)
    }
  }
}
