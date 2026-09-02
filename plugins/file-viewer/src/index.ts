import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
import FilesView from './FilesView.svelte'
import TaskFilesView from './TaskFilesView.svelte'
import { requestFileReveal } from './lib/stores'
import { projectWorkspaceIdentity, taskWorkspaceIdentity } from './lib/workspaceSource'

/** Plugin-owned command for revealing a workspace-relative file in a project or explicit Task Files view. */
export const FILE_VIEWER_REVEAL_FILE_COMMAND_ID = 'revealFile'
export const FilesViewComponent = FilesView
export const TaskFilesViewComponent = TaskFilesView

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.views.register({
      id: 'files',
      title: 'Files',
      icon: 'folder-open',
      placement: 'rail',
      order: 10,
      shortcut: 'Cmd+O',
      component: FilesView,
    }))


    context.subscriptions.add(openforge.taskPane.registerTab({
      id: 'files',
      title: 'Files',
      icon: 'folder-open',
      order: 20,
      requiresWorkspace: false,
      component: TaskFilesView,
    }))
    context.subscriptions.add(openforge.commands.register({
      id: FILE_VIEWER_REVEAL_FILE_COMMAND_ID,
      title: 'Reveal File',
      discoverable: false,
      input: {
        type: 'object',
        required: ['path'],
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          taskId: { type: 'string' },
          suffix: { type: 'string' },
        },
      },
      async handler(payload: unknown, invocationContext) {
        if (!payload || typeof payload !== 'object' || typeof (payload as { path?: unknown }).path !== 'string') {
          throw new Error('revealFile command requires a workspace-relative path string')
        }

        const { path, taskId, suffix } = payload as { path: string; taskId?: unknown; suffix?: unknown }
        if (taskId !== undefined && (typeof taskId !== 'string' || taskId.trim().length === 0)) {
          throw new Error('revealFile command taskId must be a non-empty string')
        }
        if (suffix !== undefined && typeof suffix !== 'string') {
          throw new Error('revealFile command suffix must be a string')
        }

        if (typeof taskId === 'string') {
          if (typeof suffix !== 'string') {
            throw new Error('revealFile task requests require a suffix string')
          }
          requestFileReveal(path, taskWorkspaceIdentity(taskId), suffix)
          await openforge.navigation.navigate({ taskId, taskViewId: 'files' })
          return
        }

        const workspaceIdentity = invocationContext.projectId
          ? projectWorkspaceIdentity(invocationContext.projectId)
          : null
        requestFileReveal(path, workspaceIdentity, typeof suffix === 'string' ? suffix : '')
      },
    }))
  },
})
