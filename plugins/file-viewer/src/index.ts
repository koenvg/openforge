import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import FilesView from './FilesView.svelte'
import { requestFileReveal } from './lib/stores'

/** Plugin-owned command for revealing a project-relative file path in the Files view. Payload: { path: string }. */
export const FILE_VIEWER_REVEAL_FILE_COMMAND_ID = 'revealFile'
export const FilesViewComponent = FilesView

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
        },
      },
      handler(payload: unknown) {
        if (!payload || typeof payload !== 'object' || typeof (payload as { path?: unknown }).path !== 'string') {
          throw new Error('revealFile command requires a project-relative path string')
        }

        requestFileReveal((payload as { path: string }).path)
      },
    }))
  },
})
