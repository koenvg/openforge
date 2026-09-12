import { describe, expect, it } from 'vitest'
import { inventoryLegacyUiConsumers, readLegacyUiSources } from './check-ui-migration-inventory.mjs'

// Native backlog tickets retain these consumers. KVG-4873 does not gate on them.
const pendingOwners = [
  /^src\/components\/attention\/AttentionOverviewDialog\.svelte$/, // KVG-4871
  /^src\/components\/project\/ProjectSetupDialog\.svelte$/, // KVG-4871
  /^src\/components\/task-detail\//, // KVG-4872
  /^src\/components\/shared\/pr\/(PrCommentsList|PrPipelineChecks)\.svelte$/, // KVG-4872
  /^src\/components\/shared\/tasks\/TaskRelationshipDetailSection\.svelte$/, // KVG-4872
  /^src\/styles\/terminal-presentation\.css$/, // KVG-4867, explicitly routed
  /^src\/styles\/theme-adapter\.css$/, // KVG-4874 removes the adapter last
]

const migratedHostSource = path => path.startsWith('src/')
  && !/\.test\.[cm]?[jt]s$/.test(path)
  && path !== 'src/components/settings/SettingsMigration.testFixture.svelte' // KVG-4874 transitional probes
  && !pendingOwners.some(pattern => pattern.test(path))

const dependency = record => record.kind === 'unresolved'
  ? record.token.startsWith('Parse error:')
  : !['script-component-candidate', 'build-input'].includes(record.kind)

describe('remaining host presentation inventory', () => {
  it('has no legacy classes or aliases outside the explicitly owned pending batches', () => {
    const sources = readLegacyUiSources().filter(source => migratedHostSource(source.path)
      || ['storybook/shared/ThemeFixture.svelte', 'storybook/shared/frames/ComponentFrame.svelte',
        'storybook/shared/fixtures/HostFeedback.svelte'].includes(source.path))
    expect(inventoryLegacyUiConsumers(sources).filter(dependency)).toEqual([])
  })

  it('distinguishes legacy keyboard-hint classes from the native kbd element', () => {
    const records = inventoryLegacyUiConsumers([{ path: 'src/keyboard-probe.svelte',
      contents: '<kbd>Native key</kbd><kbd class="kbd kbd-xs">Small key</kbd>',
    }]).filter(dependency)
    expect(records.map(record => record.token)).toEqual(['kbd', 'kbd-xs'])
  })

  it('recognizes conditional, script-held and direct CSS dependencies at the same boundary', () => {
    const records = inventoryLegacyUiConsumers([{ path: 'src/host-probe.svelte', contents: `
      <script>let active = true; const paint = 'bg-base-100';</script>
      <div class={active ? paint : 'hover:text-primary/50'}></div>
      <style>div { border-radius: var(--radius-field); color: var(--color-base-content); }</style>
    ` }]).filter(dependency)
    expect(records.map(record => record.token)).toEqual(expect.arrayContaining([
      'bg-base-100', 'hover:text-primary/50', '--radius-field', '--color-base-content',
    ]))
  })
})
