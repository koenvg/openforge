import type { PluginActivationResult, PluginContext } from '../../../src/lib/plugin/types'
import SkillsView from '../../../src/components/SkillsView.svelte'

interface ActivatedViewContribution {
  id: string
  component: typeof SkillsView
}

interface SkillsViewerActivationResult {
  contributions: Omit<PluginActivationResult['contributions'], 'views'> & {
    views: ActivatedViewContribution[]
  }
}

export const SkillsViewComponent = SkillsView

export async function activate(_context: PluginContext): Promise<SkillsViewerActivationResult> {
  return {
    contributions: {
      views: [
        {
          id: 'skills',
          component: SkillsView,
        },
      ],
    },
  }
}

export async function deactivate(): Promise<void> {}
