import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inventoryLegacyUiConsumers, readLegacyUiSources } from './check-ui-migration-inventory.mjs'

const routedFixtures = new Set([
  'storybook/shared/fixtures/SdkOverlays.svelte',
  'storybook/shared/fixtures/SdkWorkspace.svelte',
])

// Exact, reviewed pass-throughs; a new dynamic class expression requires review.
const reviewedUnresolved = {
  'packages/plugin-sdk/src/ui/Alert.svelte': ['{...attributes}'],
  'packages/plugin-sdk/src/ui/AnchoredMenu.svelte': ['class="of-anchored-menu {className ?? \'\'}"', '{...tooltipProps}', '{...triggerButton}', '{...props}'],
  'packages/plugin-sdk/src/ui/Badge.svelte': ['{...attributes}', 'class={className}'],
  'packages/plugin-sdk/src/ui/Button.svelte': ['{...props}'],
  'packages/plugin-sdk/src/ui/ButtonControl.svelte': ['{...attributes}', 'class={className}'],
  'packages/plugin-sdk/src/ui/Checkbox.svelte': ['class={["of-checkbox", className]}', '{...attributes}', 'class={className}'],
  'packages/plugin-sdk/src/ui/FileTypeIcon.svelte': ['class="file-type-icon {className}"'],
  'packages/plugin-sdk/src/ui/IconButton.svelte': ['{...props}'],
  'packages/plugin-sdk/src/ui/LoadingIndicator.svelte': ['{...attributes}'],
  'packages/plugin-sdk/src/ui/Modal.svelte': ['class="of-modal-layer {modalClass}"', 'class="of-modal-box {boxClass}"', '{...props}'],
  'packages/plugin-sdk/src/ui/PaletteListbox.svelte': ['class="state {listClass}"', 'class="results {listClass}"', "class={optionClass ? optionClass(entry, index, index === selectedIndex) : 'option'}"],
  'packages/plugin-sdk/src/ui/Panel.svelte': ['{...attributes}', 'class={className}'],
  'packages/plugin-sdk/src/ui/PluginPageShell.svelte': ['class="of-plugin-page-shell {className}"'],
  'packages/plugin-sdk/src/ui/PluginSidebarLink.svelte': ['{...props}'],
  'packages/plugin-sdk/src/ui/Progress.svelte': ['{...attributes}'],
  'packages/plugin-sdk/src/ui/Select.svelte': ['class="of-select-field {className ?? \'\'}"'],
  'packages/plugin-sdk/src/ui/SplitButton.svelte': ['class="of-split-button {className ?? \'\'}"'],
  'packages/plugin-sdk/src/ui/StatusBadge.svelte': ['{...attributes}', 'class={className}'],
  'packages/plugin-sdk/src/ui/Switch.svelte': ['{...attributes}', 'class={className}'],
  'packages/plugin-sdk/src/ui/Tabs.svelte': ['class="of-tabs {className ?? \'\'}"'],
  'packages/plugin-sdk/src/ui/Textarea.svelte': ['{...attributes}', 'class={className}'],
  'packages/plugin-sdk/src/ui/TextField.svelte': ['{...attributes}', 'class={className}'],
  'packages/plugin-sdk/src/ui/Tooltip.svelte': ['class="of-tooltip {className ?? \'\'}"', '{...props}'],
  'packages/plugin-sdk/src/ui/TooltipControl.svelte': ['{...currentAttributes}', '{...wrapperProps}', '{...props}'],
}

function checkReviewedUnresolved(records) {
  const unresolved = records.filter(record => record.kind === 'unresolved')
  const byPath = Object.groupBy(unresolved, record => record.path)
  expect(Object.fromEntries(Object.entries(byPath).map(([path, matches]) => [path, matches.map(match => match.token)]))).toEqual(reviewedUnresolved)
}

describe('SDK presentation inventory', () => {
  it('keeps shipped SDK views and routed fixtures clear of legacy colors and control classes', () => {
    const packedFixture = 'packages/plugin-sdk/scripts/fixtures/sdk-views/App.svelte'
    const sources = [
      ...readLegacyUiSources().filter(source =>
        (source.path.startsWith('packages/plugin-sdk/src/ui/') && source.path.endsWith('.svelte') && !/(?:TestWrapper|TestHarness)\.svelte$/.test(source.path)) || routedFixtures.has(source.path)),
      { path: packedFixture, contents: readFileSync(new URL(`../${packedFixture}`, import.meta.url), 'utf8') },
    ]
    expect(sources.map(source => source.path)).toContain('packages/plugin-sdk/src/ui/browser/SdkViewsBrowserFixture.svelte')
    expect(sources.map(source => source.path)).toContain(packedFixture)
    const records = inventoryLegacyUiConsumers(sources)
    // The only script candidate is a callback name, `toggle`, or fixture scenario
    // names `modal`, `menu`, `tooltip`, and `loading`. Spread attributes and caller-
    // supplied `class` props are supported SDK pass-throughs, not generated classes.
    expect(records.filter(record => record.kind === 'script-component-candidate')
      .map(record => [record.path, record.token])).toEqual([
        ['packages/plugin-sdk/src/ui/ProjectFileTree.svelte', 'toggle'],
        ['storybook/shared/fixtures/SdkOverlays.svelte', 'modal'],
        ['storybook/shared/fixtures/SdkOverlays.svelte', 'modal'],
        ['storybook/shared/fixtures/SdkOverlays.svelte', 'menu'],
        ['storybook/shared/fixtures/SdkOverlays.svelte', 'tooltip'],
        ['storybook/shared/fixtures/SdkWorkspace.svelte', 'loading'],
      ])
    checkReviewedUnresolved(records)
    expect(records.filter(record => !['script-component-candidate', 'unresolved'].includes(record.kind))).toEqual([])
  })
  it('rejects a new unresolved expression that could compose a legacy control', () => {
    const records = inventoryLegacyUiConsumers([{
      path: 'packages/plugin-sdk/src/ui/browser/UnreviewedFixture.svelte',
      contents: '<script>const names = ["btn"]</script><button class={names.join("")}>Open</button>',
    }])
    expect(records.map(record => record.kind)).toContain('unresolved')
    expect(() => checkReviewedUnresolved(records)).toThrow()
  })
})
