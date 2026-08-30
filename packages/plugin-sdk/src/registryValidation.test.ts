import { describe, expect, it } from 'vitest'
import { assertRegistryMatchesCanonicalManifest } from './registryValidation.mjs'

describe('canonical registry validation', () => {
  it('rejects registry values that are not objects with the configured diagnostic', () => {
    expect(() => assertRegistryMatchesCanonicalManifest({
      registryName: 'Plugin SDK example registry',
      invalidRegistryMessage: 'Plugin SDK example registry must be an object',
      actual: [],
      expected: {},
    })).toThrow('Plugin SDK example registry must be an object')
  })

  it('reports deep mismatches and unexpected keys with configurable entry diagnostics', () => {
    expect(() => assertRegistryMatchesCanonicalManifest({
      registryName: 'Plugin SDK example registry',
      actual: {
        './missing': { default: './dist/wrong.js' },
        './unexpected': './dist/unexpected.js',
        './ignored': './dist/ignored.js',
      },
      expected: {
        './missing': { default: './dist/expected.js' },
      },
      includeActualEntry: ([key]) => key !== './ignored',
      formatMissingOrMismatched: ([key, value]) => `${key} -> ${JSON.stringify(value)}`,
    })).toThrow(
      'Plugin SDK example registry drifted from the canonical manifest '
        + '(missing or mismatched: ./missing -> {"default":"./dist/expected.js"}; '
        + 'not in the canonical manifest: ./unexpected)',
    )
  })
})
