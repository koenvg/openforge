import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import terminalPackageJson from '../../plugins/terminal/package.json'
import { commandHeld, setupCommandHeldListeners } from '../../plugins/terminal/src/lib/stores'

function readTerminalSource(path: string): string {
  return readFileSync(join(process.cwd(), 'plugins/terminal/src', path), 'utf8')
}

describe('builtin terminal plugin package integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    commandHeld.set(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not depend on the private terminal-shared host implementation package', () => {
    expect(terminalPackageJson.dependencies).not.toHaveProperty('@openforge/terminal-shared')

    const sourceFiles = [
      'TaskTerminal.svelte',
      'TerminalTabs.svelte',
      'TerminalTaskPane.svelte',
      'terminalShortcutController.ts',
      'terminalShortcuts.ts',
      'terminalTaskPaneController.ts',
      'lib/ipc.ts',
      'lib/stores.ts',
      'lib/terminalPool.ts',
    ]

    for (const file of sourceFiles) {
      expect(readTerminalSource(file), `${file} should use public SDK/plugin-local code`).not.toContain('@openforge/terminal-shared')
      expect(readTerminalSource(file), `${file} should not import host src internals`).not.toContain('../../../src/')
    }
  })

  it('detects Command key holds before terminal inputs can stop bubbling', () => {
    const cleanup = setupCommandHeldListeners()
    const terminalInput = document.createElement('textarea')
    terminalInput.addEventListener('keydown', (event) => {
      event.stopPropagation()
    })
    document.body.appendChild(terminalInput)

    terminalInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', bubbles: true }))
    vi.advanceTimersByTime(150)

    expect(get(commandHeld)).toBe(true)

    terminalInput.remove()
    cleanup()
  })
})
