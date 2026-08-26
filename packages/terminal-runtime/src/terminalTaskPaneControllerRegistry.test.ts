import { describe, expect, it } from 'vitest'
import {
  createTerminalTaskPaneControllerRegistry,
  type TerminalTaskPaneController,
} from './index'

function createController(): TerminalTaskPaneController {
  return {
    addTab() {},
    async closeActiveTab() {},
    focusActiveTab() {},
    switchToTab() {},
  }
}

describe('createTerminalTaskPaneControllerRegistry', () => {
  it('creates isolated registries and only unregisters the matching controller', () => {
    const desktopRegistry = createTerminalTaskPaneControllerRegistry()
    const pluginRegistry = createTerminalTaskPaneControllerRegistry()
    const desktopController = createController()
    const replacementController = createController()

    desktopRegistry.register('T-1', desktopController)

    expect(desktopRegistry.get('T-1')).toBe(desktopController)
    expect(pluginRegistry.get('T-1')).toBeUndefined()

    desktopRegistry.register('T-1', replacementController)
    desktopRegistry.unregister('T-1', desktopController)
    expect(desktopRegistry.get('T-1')).toBe(replacementController)

    desktopRegistry.unregister('T-1', replacementController)
    expect(desktopRegistry.get('T-1')).toBeUndefined()
  })
})
