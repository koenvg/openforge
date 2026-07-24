import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
import TaskBrowserTab from './TaskBrowserTab.svelte'

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.taskUI.registerTab({
      id: 'browser',
      title: 'Browser',
      icon: 'globe',
      order: 20,
      component: TaskBrowserTab,
    }))
  },
})
