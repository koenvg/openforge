import { describe, expect, it } from 'vitest'
import { BUILTIN_PLUGIN_CATALOG } from './builtinPlugins'
import { getBuiltinPluginModule } from './builtinPluginModules'

describe('built-in plugin module map', () => {
  it('catalogs Task Browser and resolves its bundled frontend module', () => {
    expect(BUILTIN_PLUGIN_CATALOG).toContainEqual({
      id: 'com.openforge.task-browser',
      directoryName: 'task-browser',
    })
    expect(getBuiltinPluginModule('com.openforge.task-browser')).toBeDefined()
  })

  it('has a frontend module for every cataloged built-in with a frontend entry', () => {
    for (const plugin of BUILTIN_PLUGIN_CATALOG) {
      expect(getBuiltinPluginModule(plugin.id), plugin.id).toBeDefined()
    }
  })
})
