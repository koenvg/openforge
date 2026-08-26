import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, beforeEach } from 'vitest'
import { get } from 'svelte/store'

import { commandHeld as appCommandHeld } from './stores'
import { setupCommandHeldListeners as appSetupCommandHeldListeners } from './useCommandHeld.svelte'
import {
  acquire as appAcquire,
  focusTerminal as appFocusTerminal,
  getTaskTerminalTabsSession as appGetTaskTerminalTabsSession,
  release as appRelease,
  updateTaskTerminalTabsSession as appUpdateTaskTerminalTabsSession,
} from './terminalPool'
import {
  clearTerminalTaskPaneControllers as clearAppControllers,
  getTerminalTaskPaneController as getAppController,
  registerTerminalTaskPaneController as registerAppController,
  type TerminalTaskPaneController,
} from '../components/task-detail/terminalTaskPaneController'

import { commandHeld as pluginCommandHeld } from '../../plugins/terminal/src/lib/stores'
import { setupCommandHeldListeners as pluginSetupCommandHeldListeners } from '../../plugins/terminal/src/lib/stores'
import {
  acquire as pluginAcquire,
  focusTerminal as pluginFocusTerminal,
  getTaskTerminalTabsSession as pluginGetTaskTerminalTabsSession,
  release as pluginRelease,
  updateTaskTerminalTabsSession as pluginUpdateTaskTerminalTabsSession,
} from '../../plugins/terminal/src/lib/terminalPool'
import {
  clearTerminalTaskPaneControllers as clearPluginControllers,
  getTerminalTaskPaneController as getPluginController,
  registerTerminalTaskPaneController as registerPluginController,
  unregisterTerminalTaskPaneController as unregisterPluginController,
} from '../../plugins/terminal/src/terminalTaskPaneController'
import { createTaskTerminalPaneLifecycle as runtimeTaskPaneLifecycle } from '@openforge-app/terminal-runtime'
import { handleTerminalShortcutKeydown as runtimeShortcutHandler } from '@openforge-app/terminal-runtime/shortcuts'
import { handleTerminalShortcutKeydown as appShortcutHandler } from './terminalShortcuts'
import { handleTerminalShortcutKeydown as pluginShortcutHandler } from '../../plugins/terminal/src/terminalShortcuts'

describe('terminal plugin implementation boundary', () => {
  beforeEach(() => {
    appCommandHeld.set(false)
    pluginCommandHeld.set(false)
    clearAppControllers()
    clearPluginControllers()
  })

  it('uses shared terminal-runtime lifecycle helpers through host-specific thin adapters', () => {
    expect(pluginAcquire).not.toBe(appAcquire)
    expect(pluginRelease).not.toBe(appRelease)
    expect(pluginFocusTerminal).not.toBe(appFocusTerminal)
    expect(pluginGetTaskTerminalTabsSession).not.toBe(appGetTaskTerminalTabsSession)
    expect(pluginUpdateTaskTerminalTabsSession).not.toBe(appUpdateTaskTerminalTabsSession)

    expect(appShortcutHandler).toBe(runtimeShortcutHandler)
    expect(pluginShortcutHandler).toBe(runtimeShortcutHandler)
    expect(typeof runtimeTaskPaneLifecycle).toBe('function')
  })

  it('keeps task terminal pane lifecycle policy in the shared Terminal Surface', () => {
    const appLifecycleSource = readFileSync(join(process.cwd(), 'src/components/task-detail/TaskDetailLifecycle.svelte'), 'utf8')
    const appPaneSource = readFileSync(join(process.cwd(), 'src/components/task-detail/TerminalTaskPane.svelte'), 'utf8')
    const pluginPaneSource = readFileSync(join(process.cwd(), 'plugins/terminal/src/TerminalTaskPane.svelte'), 'utf8')
    const sharedPaneSource = readFileSync(join(process.cwd(), 'packages/terminal-runtime/src/TerminalTaskPaneSurface.svelte'), 'utf8')

    expect(appLifecycleSource).toContain('createTaskTerminalPaneLifecycle')
    expect(sharedPaneSource).toContain('createTaskTerminalPaneLifecycle')
    for (const source of [appPaneSource, pluginPaneSource]) {
      expect(source).toContain('@openforge-app/terminal-runtime/TerminalTaskPaneSurface')
      expect(source).not.toContain('createTaskTerminalPaneLifecycle')
    }
  })

  it('uses a plugin-owned command-held store and listener setup', () => {
    expect(pluginCommandHeld).not.toBe(appCommandHeld)
    expect(pluginSetupCommandHeldListeners).not.toBe(appSetupCommandHeldListeners)

    appCommandHeld.set(true)
    expect(get(pluginCommandHeld)).toBe(false)

    pluginCommandHeld.set(true)
    expect(get(appCommandHeld)).toBe(true)
  })

  it('uses a plugin-owned task-pane controller registry', async () => {
    const controller: TerminalTaskPaneController = {
      addTab() {},
      async closeActiveTab() {},
      focusActiveTab() {},
      switchToTab() {},
    }

    registerAppController('T-861', controller)
    expect(getPluginController('T-861')).toBeUndefined()

    registerPluginController('T-861', controller)
    expect(getAppController('T-861')).toBe(controller)
    expect(getPluginController('T-861')).toBe(controller)

    unregisterPluginController('T-861', controller)
    expect(getAppController('T-861')).toBe(controller)
    expect(getPluginController('T-861')).toBeUndefined()
  })
})
