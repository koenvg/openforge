import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
import Section from './Section.svelte'

export { Section }

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.views.register({
      id: 'spacing',
      title: 'SDK spacing contract',
      icon: 'notebook-text',
      placement: 'rail',
      component: async () => ({ default: Section }),
    }))
    context.subscriptions.add(openforge.taskUI.registerSection({
      id: 'spacing',
      component: async () => ({ default: Section }),
    }))
  },
})
