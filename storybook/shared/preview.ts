import type { Preview } from '@storybook/svelte-vite'
import './preview.css'
import { storyEnvironmentPreview } from './storyEnvironmentPreview'

const preview: Preview = {
  beforeEach: storyEnvironmentPreview.beforeEach,
  initialGlobals: {
    openforgeTheme: 'openforge-light',
    openforgeMotion: 'reduced',
  },
  globalTypes: {
    openforgeMotion: {
      description: 'Motion',
      toolbar: {
        icon: 'play',
        items: [
          { value: 'reduced', title: 'Freeze motion' },
          { value: 'normal', title: 'Production motion' },
        ],
      },
    },
    openforgeTheme: {
      description: 'OpenForge theme',
      toolbar: {
        icon: 'paintbrush',
        items: [
          { value: 'openforge-light', title: 'Light' },
          { value: 'openforge-dark', title: 'Dark' },
        ],
      },
    },
  },
  decorators: [
    ...storyEnvironmentPreview.decorators,
    (Story, context) => {
      document.documentElement.dataset.storybookMotion = context.globals.openforgeMotion === 'normal' ? 'normal' : 'reduced'
      document.body.style.margin = '0'
      document.body.style.background = 'var(--of-canvas)'
      document.body.style.color = 'var(--of-text)'
      return Story()
    },
  ],
  parameters: {
    ...storyEnvironmentPreview.parameters,
    layout: 'fullscreen',
    viewport: {
      options: {
        desktop: {
          name: 'Desktop',
          styles: { width: '1440px', height: '900px' },
          type: 'desktop',
        },
        narrow: {
          name: 'Narrow desktop',
          styles: { width: '900px', height: '900px' },
          type: 'desktop',
        },
        component: {
          name: 'Component canvas',
          styles: { width: '640px', height: '640px' },
          type: 'desktop',
        },
      },
    },
    a11y: {
      test: 'todo',
    },
  },
}

export default preview
