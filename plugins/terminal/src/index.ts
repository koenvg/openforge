import type { PluginActivationResult, PluginContext } from '@openforge/plugin-sdk'
import TerminalTaskPane from '../../../src/components/task-detail/TerminalTaskPane.svelte'

export async function activate(_context: PluginContext): Promise<PluginActivationResult> {
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
