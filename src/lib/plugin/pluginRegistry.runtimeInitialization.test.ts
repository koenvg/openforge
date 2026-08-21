import { beforeEach, describe, expect, it } from 'vitest'
import {
  initializePluginRuntime,
  installPluginMock,
  resetPluginRegistryTestState,
} from './pluginRegistryTestSupport'

describe('pluginRegistry runtime initialization', () => {
  beforeEach(resetPluginRegistryTestState)

  it('initializePluginRuntime installs builtin package metadata with built frontend entries', async () => {
    installPluginMock.mockResolvedValue(undefined)

    await initializePluginRuntime()

    expect(installPluginMock).toHaveBeenCalled()
    expect(installPluginMock.mock.calls.every(([row]) => row.isBuiltin === true)).toBe(true)
    expect(installPluginMock.mock.calls.every(([row]) => row.sourceKind === 'builtin')).toBe(true)
    expect(installPluginMock.mock.calls.every(([row]) => row.frontendEntry === './dist/frontend.js')).toBe(true)
    expect(installPluginMock.mock.calls.every(([row]) => row.contributes === '{}')).toBe(true)
    expect(installPluginMock.mock.calls.every(([row]) => JSON.parse(row.packageMetadata).frontend === './dist/frontend.js')).toBe(true)
  })
})
