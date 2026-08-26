import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
import TerminalTaskPane from './TerminalTaskPane.svelte'
import TerminalProjectView from './TerminalProjectView.svelte'
import { setTerminalOpenForgeApi } from './lib/ipc'
import { releaseAll } from './lib/terminalPool'

export default defineFrontendPlugin({
  activate(openforge, context) {
    setTerminalOpenForgeApi(openforge)
    context.subscriptions.add(() => {
      releaseAll()
      setTerminalOpenForgeApi(null)
    })

    context.subscriptions.add(openforge.views.register({
      id: 'terminal',
      title: 'Terminal',
      icon: 'terminal',
      placement: 'rail',
      order: 40,
      shortcut: 'Cmd+J',
      component: TerminalProjectView,
    }))

    context.subscriptions.add(openforge.taskPane.registerTab({
      id: 'terminal',
      title: 'Terminal',
      icon: 'terminal',
      order: 10,
      component: TerminalTaskPane,
    }))
  },
})
