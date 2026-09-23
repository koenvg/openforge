import { describe, expect, it } from 'vitest'
import { inventoryLegacyUiConsumers, readLegacyUiSources } from './check-ui-migration-inventory.mjs'

// Reviewed non-style strings in tests and callbacks: accessibility roles, action
// names and domain loading states. The dynamic language class is syntax highlighting.
const candidates = {
  'arcCdp.ts': ['tab'],
  'FileContentViewer.svelte': ['class="file-preview-code block flex-1 whitespace-pre {language ? `language-${language}` : \'\'}"'],
  'FileContentViewer.test.ts': ['loading', 'alert'],
  'FilesView.browsing.test.ts': ['toggle'],
  'FilesView.loading-errors.test.ts': ['loading'],
  'FilesView.reveal.test.ts': ['select'],
  'FilesView.svelte': ['loading'],
  'FileTreeStates.test.ts': ['loading'],
  'index.test.ts': ['tab'],
  'TaskFilesView.test.ts': ['loading'],
}

describe('File Viewer semantic presentation inventory', () => {
  it('has no legacy consumers or unexplained dynamic classes in the plugin and its executable frame', () => {
    const sources = readLegacyUiSources().filter(source =>
      source.path.startsWith('plugins/file-viewer/') || source.path === 'storybook/shared/frames/FileViewerModule.svelte')
    expect(sources.length).toBeGreaterThan(10)
    const unexplained = inventoryLegacyUiConsumers(sources).filter(record => {
      const filename = record.path.split('/').at(-1)
      return !((record.kind === 'script-component-candidate' || record.kind === 'unresolved')
        && candidates[filename]?.includes(record.token))
    })
    expect(unexplained).toEqual([])
  })
})
