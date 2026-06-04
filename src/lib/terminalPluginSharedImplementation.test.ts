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

describe('terminal plugin implementation boundary', () => {
  beforeEach(() => {
    appCommandHeld.set(false)
    pluginCommandHeld.set(false)
    clearAppControllers()
    clearPluginControllers()
  })

  it('keeps the plugin terminal pool separate from host app terminal internals', () => {
    expect(pluginAcquire).not.toBe(appAcquire)
    expect(pluginRelease).not.toBe(appRelease)
    expect(pluginFocusTerminal).not.toBe(appFocusTerminal)
    expect(pluginGetTaskTerminalTabsSession).not.toBe(appGetTaskTerminalTabsSession)
    expect(pluginUpdateTaskTerminalTabsSession).not.toBe(appUpdateTaskTerminalTabsSession)
  })

  it('keeps plugin command-held state local to the plugin package', () => {
    expect(pluginCommandHeld).not.toBe(appCommandHeld)
    expect(pluginSetupCommandHeldListeners).not.toBe(appSetupCommandHeldListeners)

    appCommandHeld.set(true)
    expect(get(pluginCommandHeld)).toBe(false)

    appCommandHeld.set(false)
    pluginCommandHeld.set(true)
    expect(get(appCommandHeld)).toBe(false)
  })

  it('keeps the plugin task-pane controller registry separate from the host app registry', async () => {
    const controller: TerminalTaskPaneController = {
      addTab() {},
      async closeActiveTab() {},
      focusActiveTab() {},
      switchToTab() {},
    }

    registerAppController('T-861', controller)
    expect(getPluginController('T-861')).toBeUndefined()

    unregisterPluginController('T-861', controller)
    expect(getAppController('T-861')).toBe(controller)

    registerPluginController('T-861', controller)
    expect(getAppController('T-861')).toBe(controller)
    expect(getPluginController('T-861')).toBe(controller)
  })
})
