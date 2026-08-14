import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
import TaskBrowserTab from './TaskBrowserTab.svelte'
import { createTaskBrowserOpenCommand, disposeTaskBrowserOpenObservers } from './agentOpenCommand'
import { createTaskBrowserLinkHandler } from './taskLinkHandler'

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.commands.register(createTaskBrowserOpenCommand(openforge)))
    context.subscriptions.add(() => disposeTaskBrowserOpenObservers(openforge))
    context.subscriptions.add(openforge.taskUI.registerTab({
      id: 'browser',
      title: 'Browser',
      icon: 'globe',
      order: 20,
      component: TaskBrowserTab,
    }))
    context.subscriptions.add(openforge.taskLinks.registerHandler(createTaskBrowserLinkHandler(openforge)))
  },
})
