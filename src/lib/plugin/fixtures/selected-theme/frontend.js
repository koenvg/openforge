import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
import tokens from './tokens.js'

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.themes.register({
      id: 'paper',
      label: 'Fixture Paper',
      appearance: 'light',
      tokens,
      stylesheets: ['./paper.css', './accents.css'],
    }))
  },
})
