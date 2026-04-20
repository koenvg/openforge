import { describe, expect, it } from 'vitest'
import { makePluginViewKey, isPluginViewKey, parsePluginViewKey, MAX_SUPPORTED_API_VERSION } from './types'

describe('PluginViewKey helpers', () => {
  it('creates a valid PluginViewKey', () => {
    expect(makePluginViewKey('com.openforge.files', 'main')).toBe('plugin:com.openforge.files:main')
  })

  it('recognizes valid PluginViewKey', () => {
    expect(isPluginViewKey('plugin:com.openforge.files:main')).toBe(true)
  })

  it('rejects non-plugin keys', () => {
    expect(isPluginViewKey('board')).toBe(false)
    expect(isPluginViewKey('settings')).toBe(false)
    expect(isPluginViewKey('plugin:only-one-colon')).toBe(false)
    expect(isPluginViewKey('')).toBe(false)
  })

  it('parses a PluginViewKey into parts', () => {
    const { pluginId, viewId } = parsePluginViewKey('plugin:com.openforge.files:main')
    expect(pluginId).toBe('com.openforge.files')
    expect(viewId).toBe('main')
  })

  it('MAX_SUPPORTED_API_VERSION is a positive integer', () => {
    expect(MAX_SUPPORTED_API_VERSION).toBeGreaterThan(0)
    expect(Number.isInteger(MAX_SUPPORTED_API_VERSION)).toBe(true)
  })
})
