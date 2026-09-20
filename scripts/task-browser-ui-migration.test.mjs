import { describe, expect, it } from 'vitest'
import { inventoryLegacyUiConsumers, readLegacyUiSources } from './check-ui-migration-inventory.mjs'

// Reviewed non-class strings: SDK browser state keys, command inputs, surface
// identifiers, keyboard actions, and testing-library accessibility roles.
const candidates = {
  'agentOpenCommand.test.ts': ['loading', 'input'],
  'browserTabSession.test.ts': ['tab', 'loading'],
  'browserTabSession.ts': ['tab'],
  'index.test.ts': ['tab'],
  'TaskBrowserTab.svelte': ['toggle'],
  'TaskBrowserTab.test.ts': ['alert'],
}

describe('Task Browser semantic presentation inventory', () => {
  it('has no legacy consumers or unexplained dynamic classes, including executable tests', () => {
    const prefix = 'plugins/task-browser/'
    const sources = readLegacyUiSources().filter(source => source.path.startsWith(prefix))
    expect(sources.length).toBeGreaterThan(3)
    const unexplained = inventoryLegacyUiConsumers(sources).filter(record => {
      const filename = record.path.slice(`${prefix}src/`.length)
      return !(record.kind === 'script-component-candidate' && candidates[filename]?.includes(record.token))
    })
    expect(unexplained).toEqual([])
  })
})
