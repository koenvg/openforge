import { describe, expect, it } from 'vitest'
import { inventoryLegacyUiConsumers, readLegacyUiSources } from './check-ui-migration-inventory.mjs'

const routedConsumers = new Set([
  'src/components/shared/pr/PrCommentsList.svelte',
  'src/components/shared/pr/PrPipelineChecks.svelte',
  'src/components/shared/tasks/TaskRelationshipDetailSection.svelte',
  'storybook/shared/frames/StatusFrame.svelte',
  'storybook/shared/frames/TaskPaneFrame.svelte',
])

// These expressions resolve to the migrated literals in their component scripts.
// Wrapper spreads carry caller props into the separately owned terminal/plugin views.
const reviewedExpressions = {
  'src/components/shared/pr/PrCommentsList.svelte': [
    'class="{cardBaseClass} cursor-pointer hover:border-of-accent/50 transition-colors{comment.addressed === 1 ? \' opacity-60\' : \'\'}"',
    'class="{cardBaseClass}{comment.addressed === 1 ? \' opacity-60\' : \'\'}"',
  ],
  'src/components/shared/tasks/TaskRelationshipDetailSection.svelte': [
    'idSpanClass', 'statusSpanClass', 'projectSpanClass', 'titleSpanClass', 'readinessSpanClass',
    'itemListClass', 'statusItemClass', 'footerClass', 'sectionElementClass', 'headingElementClass',
  ].map(name => `class={${name}}`),
  'src/components/task-detail/TaskDetailProviderHost.svelte': ['{...renderProps}'],
  'src/components/task-detail/TaskDetailView.svelte': ['class="min-h-0 overflow-hidden {agentWorkbenchClass}"', 'class={agentMainClass}'],
  'src/components/task-detail/TaskInfoPanel.svelte': ['class="flex min-h-max flex-col {panelClass}"'],
  'src/components/task-detail/TaskTerminal.svelte': ['{...props}'],
  'src/components/task-detail/TerminalTabs.svelte': ['{...props}'],
}

describe('task-detail semantic presentation inventory', () => {
  it('keeps the migrated host consumer group free of legacy colors and feedback controls', () => {
    const sources = readLegacyUiSources().filter(source => routedConsumers.has(source.path)
      || (source.path.startsWith('src/components/task-detail/') && source.path.endsWith('.svelte')))
    expect(sources.length).toBeGreaterThan(routedConsumers.size)
    const consumers = inventoryLegacyUiConsumers(sources).filter(record => record.kind !== 'unresolved'
      || !reviewedExpressions[record.path]?.includes(record.token))
    expect(consumers).toEqual([])
  })
})
