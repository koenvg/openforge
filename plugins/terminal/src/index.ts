import type { PluginActivationResult, PluginContext } from '@openforge/plugin-sdk'
import TerminalTaskPane from './TerminalTaskPane.svelte'
import { setPluginContext } from './pluginContext'

export async function activate(context: PluginContext): Promise<PluginActivationResult> {
  setPluginContext(context)
  return {
    contributions: {
      taskPaneTabs: [
        {
          id: 'terminal',
          component: TerminalTaskPane,
        },
      ],
      backgroundServices: [
        {
          id: 'pty-manager',
          start: async () => undefined,
          stop: async () => undefined,
        },
      ],
    }
  }
}

export async function deactivate(): Promise<void> {}
