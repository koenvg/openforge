import type { MessageBoxOptions } from 'electron'
import type { TaskBrowserPermissionPromptRequest } from './taskBrowserPermissionPolicy.js'

export function taskBrowserPermissionPromptOptions(
  request: TaskBrowserPermissionPromptRequest,
): MessageBoxOptions {
  return {
    type: 'question',
    title: 'Task Browser Permission',
    message: `Allow ${request.origin} to use ${request.permissionLabel}?`,
    detail: `Requesting origin: ${request.origin}\nPermission: ${request.permissionLabel}`,
    buttons: ['Allow', 'Block'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    checkboxLabel: 'Remember for this Task',
    checkboxChecked: false,
  }
}
