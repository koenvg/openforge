import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import TaskSchedulesView from './components/TaskSchedulesView.svelte'

export const TaskSchedulesViewComponent = TaskSchedulesView

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.views.register({
      id: 'schedules',
      title: 'Task Schedules',
      icon: 'clock',
      placement: 'rail',
      order: 50,
      component: TaskSchedulesView,
    }))
  },
})
