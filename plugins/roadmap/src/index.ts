import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import RoadmapView from './components/RoadmapView.svelte'

export const RoadmapViewComponent = RoadmapView

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(
      openforge.views.register({
        id: 'roadmap',
        title: 'Roadmap',
        icon: 'kanban',
        placement: 'rail',
        order: 40,
        shortcut: 'Cmd+R',
        component: RoadmapView,
      }),
    )
  },
})
