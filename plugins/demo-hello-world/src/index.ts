// NOTE: In production, plugins would import from '@openforge/plugin-sdk'
// For this demo, we import directly from the host types since SDK doesn't exist yet (Task 10)
import type { PluginContext, PluginActivationResult } from '../../src/lib/plugin/types'
import HelloWorldView from './components/HelloWorldView.svelte'

export async function activate(context: PluginContext): Promise<PluginActivationResult> {
  return {
    contributions: {
      views: [
        {
          id: 'hello',
          title: 'Hello World',
          icon: 'plug',
          component: HelloWorldView,
        },
      ],
    },
  }
}

export async function deactivate(): Promise<void> {}
