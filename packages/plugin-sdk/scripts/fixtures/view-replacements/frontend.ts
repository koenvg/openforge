import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'

export default defineFrontendPlugin({
  activate(api, context) {
    context.subscriptions.add(api.viewReplacements.register({
      id: 'dashboard',
      target: 'project.dashboard',
      title: 'Task list',
      icon: 'layout-dashboard',
      component: () => import('./Dashboard.svelte'),
    }))
    context.subscriptions.add(api.viewReplacements.register({
      id: 'task-detail',
      target: 'task.detail',
      title: 'Task brief',
      component: () => import('./TaskDetail.svelte'),
    }))
  },
})
