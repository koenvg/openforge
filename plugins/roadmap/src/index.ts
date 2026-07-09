import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
import RoadmapView from './components/RoadmapView.svelte'
import RoadmapTaskPane from './components/RoadmapTaskPane.svelte'

export const RoadmapViewComponent = RoadmapView
export const RoadmapTaskPaneComponent = RoadmapTaskPane

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(
      openforge.views.register({
        id: 'roadmap',
        title: 'Roadmap',
        icon: 'kanban',
        placement: 'rail',
        order: 21,
        shortcut: 'Cmd+R',
        component: RoadmapView,
      }),
    )
    context.subscriptions.add(
      openforge.taskPane.registerTab({
        id: 'roadmap-ticket',
        title: 'Roadmap ticket',
        icon: 'ticket',
        order: 30,
        component: RoadmapTaskPane,
      }),
    )
  },
})
