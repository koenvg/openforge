import { describe, expect, it } from 'vitest'
import { inventoryLegacyUiConsumers, readLegacyUiSources } from './check-ui-migration-inventory.mjs'

const owned = path => /^(packages\/terminal-runtime\/|plugins\/terminal\/)/.test(path)
  || path === 'src/styles/terminal-presentation.css'

// These wrappers accept identity, workspace, activity, and callbacks, not classes.
const reviewedSpreads = new Set([
  'packages/terminal-runtime/src/TerminalTabsTaskTerminal.svelte',
  'plugins/terminal/src/TaskTerminal.svelte',
  'plugins/terminal/src/TerminalTabs.svelte',
])
const reviewedStateStrings = new Set([
  'packages/terminal-runtime/src/taskPaneWorkspaceLookup.ts',
  'packages/terminal-runtime/src/terminalControls.ts',
  'packages/terminal-runtime/src/TerminalTaskPaneSurface.svelte',
])
const reviewedInputEvents = new Set([
  'packages/terminal-runtime/conformance/run.mjs',
  'packages/terminal-runtime/conformance/src/main.ts',
])

// Reviewed role queries, native element names, event names, and state literals.
// Test files remain in the scan; new colors, classes, and unresolved producers fail.
const reviewedTestCandidates = {
  'packages/terminal-runtime/src/taskPaneWorkspaceLookup.test.ts': ['loading'],
  'packages/terminal-runtime/src/taskTerminalController.test.ts': ['tab'],
  'packages/terminal-runtime/src/TaskTerminalSurface.test.ts': ['alert'],
  'packages/terminal-runtime/src/taskTerminalTabsSession.test.ts': ['tabs', 'tab'],
  'packages/terminal-runtime/src/terminalControls.test.ts': ['loading', 'tab', 'tabs'],
  'packages/terminal-runtime/src/terminalOptions.test.ts': ['loading'],
  'packages/terminal-runtime/src/terminalRuntimeDisposal.integration.test.ts': ['input'],
  'packages/terminal-runtime/src/terminalRuntimeResize.integration.test.ts': ['input'],
  'packages/terminal-runtime/src/terminalRuntimeSequencing.integration.test.ts': ['input'],
  'packages/terminal-runtime/src/terminalRuntimeShellLifecycle.integration.test.ts': ['tab', 'input'],
  'packages/terminal-runtime/src/terminalShortcuts.test.ts': ['tab'],
  'packages/terminal-runtime/src/xtermTerminalView.test.ts': ['input'],
  'packages/terminal-runtime/src/xtermTerminalViewRendering.test.ts': ['loading'],
  'plugins/terminal/src/lib/stores.test.ts': ['input', 'textarea'],
  'plugins/terminal/src/TerminalProjectView.test.ts': ['tabs', 'tab'],
  'plugins/terminal/src/terminalShortcuts.test.ts': ['tab'],
  'plugins/terminal/src/TerminalTabs.test.ts': ['tab'],
  'plugins/terminal/src/TerminalTaskPane.test.ts': ['loading'],
}

function isReviewed(record) {
  if (record.kind === 'unresolved') return record.token === '{...props}' && reviewedSpreads.has(record.path)
  if (record.kind !== 'script-component-candidate') return false
  return (record.token === 'loading' && reviewedStateStrings.has(record.path))
    || (record.token === 'input' && reviewedInputEvents.has(record.path))
    || reviewedTestCandidates[record.path]?.includes(record.token)
}

// Keyboard-hint semantics and geometry are also checked in the no-legacy-CSS
// browser fixture, including checkouts before KVG-4873's expanded scanner.

describe('terminal presentation migration inventory', () => {
  it('clears runtime, plugin, host scrollbar, and executable conformance consumers', () => {
    const sources = readLegacyUiSources().filter(source => owned(source.path))
    expect(sources.some(source => source.path.endsWith('conformance/src/style.css'))).toBe(true)
    expect(inventoryLegacyUiConsumers(sources).filter(record => !isReviewed(record))).toEqual([])
  })
})
