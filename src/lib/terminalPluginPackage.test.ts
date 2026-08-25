import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { commandHeld, setupCommandHeldListeners } from '../../plugins/terminal/src/lib/stores'

describe('builtin terminal plugin package integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    commandHeld.set(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('loads xterm CSS through the shared Terminal Surface', () => {
    const taskTerminalSource = readFileSync(join(process.cwd(), 'plugins/terminal/src/TaskTerminal.svelte'), 'utf8')
    const sharedTaskTerminalSource = readFileSync(join(process.cwd(), 'packages/terminal-runtime/src/TaskTerminalSurface.svelte'), 'utf8')
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'plugins/terminal/package.json'), 'utf8'))

    expect(taskTerminalSource).toContain('@openforge-app/terminal-runtime/TaskTerminalSurface')
    expect(sharedTaskTerminalSource).toContain("import './xterm.css'")
    expect(sharedTaskTerminalSource).not.toContain('@xterm/xterm/css/xterm.css')
    expect(packageJson.dependencies['@openforge-app/terminal-runtime']).toBe('workspace:*')
    expect(packageJson.dependencies['@xterm/xterm']).toBeUndefined()
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
