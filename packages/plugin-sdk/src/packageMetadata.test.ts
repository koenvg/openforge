import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
  MAX_SUPPORTED_API_VERSION,
  MIN_SUPPORTED_API_VERSION,
  OPENFORGE_PACKAGE_METADATA_SCHEMA,
  OPENFORGE_PLUGIN_API_VERSION,
  OPENFORGE_PLUGIN_CAPABILITIES,
  SUPPORTED_OPENFORGE_API_VERSIONS,
  isOpenForgePackageMetadata,
  isSupportedOpenForgeApiVersion,
  validateOpenForgePackageMetadata,
} from './index'
import type { OpenForgePackageMetadata, SupportedOpenForgeApiVersion } from './index'

function validMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'github',
    apiVersion: OPENFORGE_PLUGIN_API_VERSION,
    displayName: 'GitHub',
    description: 'GitHub PR review and sync',
    icon: 'github',
    frontend: './dist/frontend.js',
    frontendStyles: ['./dist/plugin.css'],
    backend: './dist/backend.mjs',
    requires: ['projects', 'tasks', 'commands', 'storage'],
    ...overrides,
  }
}

describe('package.json#openforge metadata contract', () => {
  afterEach(() => {
    vi.doUnmock('./openforgePackageMetadataSchema.json')
    vi.resetModules()
  })
  it('defaults omitted enablement to project ownership', () => {
    const metadata = validMetadata()

    expect(validateOpenForgePackageMetadata(metadata)).toEqual([])
    expect(metadata).not.toHaveProperty('enablement')
  })

  it('accepts ESM, legacy JavaScript, and CommonJS backend artifacts', () => {
    for (const backend of ['./dist/backend.mjs', './dist/backend.js', './dist/backend.cjs']) {
      expect(validateOpenForgePackageMetadata(validMetadata({ backend }))).toEqual([])
    }
    expect(validateOpenForgePackageMetadata(validMetadata({ backend: './dist/backend.ts' }))).toContainEqual({
      path: 'backend',
      message: 'Must point to a built .mjs, .js, or .cjs artifact',
    })
  })

  it('accepts explicit app enablement with its required host capability', () => {
    expect(validateOpenForgePackageMetadata(validMetadata({
      enablement: 'app',
      requires: ['appEnablement'],
    }))).toEqual([])
    expect(OPENFORGE_PLUGIN_CAPABILITIES).toContain('appEnablement')
  })

  it('accepts themes only for app-enabled frontend plugins', () => {
    expect(validateOpenForgePackageMetadata(validMetadata({
      enablement: 'app',
      requires: ['appEnablement', 'themes'],
    }))).toEqual([])
    expect(OPENFORGE_PLUGIN_CAPABILITIES).toContain('themes')

    expect(validateOpenForgePackageMetadata(validMetadata({
      requires: ['themes'],
    }))).toContainEqual({
      path: 'enablement',
      message: 'themes capability requires app enablement',
    })
    expect(validateOpenForgePackageMetadata(validMetadata({
      enablement: 'app',
      frontend: undefined,
      frontendStyles: undefined,
      requires: ['appEnablement', 'themes'],
    }))).toContainEqual({
      path: 'requires',
      message: 'themes capability requires a frontend entry',
    })
  })

  it('rejects invalid enablement values and app enablement without capability gating', () => {
    expect(validateOpenForgePackageMetadata(validMetadata({ enablement: 'workspace' }))).toContainEqual({
      path: 'enablement',
      message: 'Must be "app" or "project"',
    })
    expect(validateOpenForgePackageMetadata(validMetadata({ enablement: 'app' }))).toContainEqual({
      path: 'requires',
      message: 'App enablement requires the appEnablement capability',
    })
  })

  it('accepts custom sidebar navigation as an explicit host capability', () => {
    expect(validateOpenForgePackageMetadata(validMetadata({
      requires: ['customSidebarNavigation'],
    }))).toEqual([])
    expect(OPENFORGE_PLUGIN_CAPABILITIES).toContain('customSidebarNavigation')
  })

  it('validates ADR package metadata without manifest contributions', () => {
    expect(validateOpenForgePackageMetadata(validMetadata())).toEqual([])
    expect(isOpenForgePackageMetadata(validMetadata())).toBe(true)
  })

  it('accepts the public SVG icon contract in package metadata', () => {
    expect(validateOpenForgePackageMetadata(validMetadata({
      icon: {
        type: 'svg',
        svg: '<svg viewBox="0 0 24 24"><rect x="15" y="5" width="4" height="12"/><rect x="7" y="8" width="4" height="9"/></svg>',
      },
    }))).toEqual([])
  })

  it('rejects malformed package icon values', () => {
    for (const icon of ['', '   ', { type: 'svg', svg: '' }, { type: 'svg', svg: '   ' }, { type: 'png', svg: '<svg></svg>' }, { type: 'svg', svg: '<svg></svg>', extra: true }]) {
      expect(validateOpenForgePackageMetadata(validMetadata({ icon }))).toContainEqual({
        path: 'icon',
        message: 'Must be a non-empty Lucide icon name or { type: "svg", svg }',
      })
    }
  })

  it('accepts clipboard writing as a declared trusted-plugin capability', () => {
    expect(validateOpenForgePackageMetadata(validMetadata({
      requires: ['system.writeClipboardText'],
    }))).toEqual([])
    expect(OPENFORGE_PLUGIN_CAPABILITIES).toContain('system.writeClipboardText')
  })

  it('accepts injection points as a declared plugin capability', () => {
    expect(validateOpenForgePackageMetadata(validMetadata({
      requires: ['injectionPoints'],
    }))).toEqual([])
    expect(OPENFORGE_PLUGIN_CAPABILITIES).toContain('injectionPoints')
  })
  it('accepts browserSurfaces only as a declared frontend capability', () => {
    expect(validateOpenForgePackageMetadata(validMetadata({
      requires: ['browserSurfaces'],
    }))).toEqual([])
    expect(OPENFORGE_PLUGIN_CAPABILITIES).toContain('browserSurfaces')
    expect(validateOpenForgePackageMetadata(validMetadata({
      frontend: undefined,
      frontendStyles: undefined,
      requires: ['browserSurfaces'],
    }))).toContainEqual({
      path: 'requires',
      message: 'browserSurfaces capability requires a frontend entry',
    })
  })

  it('rejects legacy manifest contribution arrays', () => {
    const errors = validateOpenForgePackageMetadata(validMetadata({
      contributes: {
        views: [{ id: 'prs', title: 'Pull Requests', icon: 'git-pull-request' }],
      },
    }))

    expect(errors).toContainEqual({
      path: 'contributes',
      message: 'Manifest contribution arrays are not supported; register contributions at runtime',
    })
  })

  it('rejects missing and malformed required metadata', () => {
    const errors = validateOpenForgePackageMetadata({
      id: '',
      apiVersion: '1',
      displayName: '',
      description: '',
      frontend: '',
      backend: 123,
      frontendStyles: 'dist/plugin.css',
      requires: ['tasks', 'unknown-capability', 42],
    })

    expect(errors).toContainEqual({ path: 'id', message: 'Required string' })
    expect(errors).toContainEqual({ path: 'apiVersion', message: 'Required integer' })
    expect(errors).toContainEqual({ path: 'displayName', message: 'Required string' })
    expect(errors).toContainEqual({ path: 'description', message: 'Required string' })
    expect(errors).toContainEqual({ path: 'frontend', message: 'Must be a non-empty string' })
    expect(errors).toContainEqual({ path: 'backend', message: 'Must be a non-empty string' })
    expect(errors).toContainEqual({ path: 'frontendStyles', message: 'Must be an array' })
    expect(errors).toContainEqual({ path: 'requires[1]', message: 'Unknown OpenForge capability "unknown-capability"' })
    expect(errors).toContainEqual({ path: 'requires[2]', message: 'Must be a string' })
  })

  it('validates declared frontend stylesheet paths', () => {
    expect(validateOpenForgePackageMetadata(validMetadata({
      frontendStyles: ['./dist/plugin.css', './dist/theme.css'],
    }))).toEqual([])

    expect(validateOpenForgePackageMetadata(validMetadata({ frontendStyles: 'dist/plugin.css' }))).toContainEqual({
      path: 'frontendStyles',
      message: 'Must be an array',
    })
    expect(validateOpenForgePackageMetadata(validMetadata({ frontendStyles: ['', 42] }))).toEqual(expect.arrayContaining([
      { path: 'frontendStyles[0]', message: 'Must be a non-empty string' },
      { path: 'frontendStyles[1]', message: 'Must be a non-empty string' },
    ]))
    expect(validateOpenForgePackageMetadata(validMetadata({ frontendStyles: [] }))).toContainEqual({
      path: 'frontendStyles',
      message: 'Must contain at least one stylesheet path',
    })
    expect(validateOpenForgePackageMetadata(validMetadata({
      frontendStyles: ['./dist/plugin.css', './dist/plugin.css'],
    }))).toContainEqual({
      path: 'frontendStyles[1]',
      message: 'Duplicate stylesheet path',
    })
    expect(validateOpenForgePackageMetadata(validMetadata({
      frontendStyles: ['./dist/plugin.js'],
    }))).toContainEqual({
      path: 'frontendStyles[0]',
      message: 'Must point to a built CSS artifact',
    })
    expect(validateOpenForgePackageMetadata(validMetadata({ frontend: undefined }))).toContainEqual({
      path: 'frontendStyles',
      message: 'Requires a frontend entry',
    })
  })

  it('uses apiVersion as a hard compatibility gate', () => {
    expect(OPENFORGE_PLUGIN_API_VERSION).toBe(1)
    expect(MIN_SUPPORTED_API_VERSION).toBe(1)
    expect(MAX_SUPPORTED_API_VERSION).toBe(1)
    expect(SUPPORTED_OPENFORGE_API_VERSIONS).toEqual([1])
    expect(isSupportedOpenForgeApiVersion(1)).toBe(true)
    expect(isSupportedOpenForgeApiVersion(0)).toBe(false)
    expect(isSupportedOpenForgeApiVersion(2)).toBe(false)

    expect(validateOpenForgePackageMetadata(validMetadata({ apiVersion: 2 }))).toContainEqual({
      path: 'apiVersion',
      message: 'API version 2 not supported (supported: 1)',
    })
  })

  it('ships a shared JSON Schema for package.json#openforge with no contribution arrays', () => {
    expect(OPENFORGE_PACKAGE_METADATA_SCHEMA).toMatchObject({
      type: 'object',
      required: ['id', 'apiVersion', 'displayName', 'description'],
    })
    expect(OPENFORGE_PACKAGE_METADATA_SCHEMA.properties).not.toHaveProperty('contributes')
    expect(OPENFORGE_PACKAGE_METADATA_SCHEMA.properties.icon).toMatchObject({
      oneOf: [
        { type: 'string', minLength: 1 },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'svg'],
          properties: {
            type: { const: 'svg' },
            svg: { type: 'string', minLength: 1 },
          },
        },
      ],
    })
    expect(OPENFORGE_PACKAGE_METADATA_SCHEMA.properties.frontendStyles).toMatchObject({
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
    })
    expect(OPENFORGE_PACKAGE_METADATA_SCHEMA.dependentRequired).toEqual({ frontendStyles: ['frontend'] })
    expect(OPENFORGE_PACKAGE_METADATA_SCHEMA.allOf).toContainEqual({
      if: {
        properties: { requires: { contains: { enum: ['browserSurfaces', 'viewReplacements', 'themes'] } } },
        required: ['requires'],
      },
      then: { required: ['frontend'] },
    })
    expect(OPENFORGE_PACKAGE_METADATA_SCHEMA.additionalProperties).toBe(false)
    expect(OPENFORGE_PACKAGE_METADATA_SCHEMA.properties.apiVersion).toEqual({ enum: [1] })
  })

  it('keeps public apiVersion types as literal supported version unions', () => {
    expectTypeOf<SupportedOpenForgeApiVersion>().toEqualTypeOf<1>()
    expectTypeOf<OpenForgePackageMetadata['apiVersion']>().toEqualTypeOf<1>()
    expectTypeOf<typeof OPENFORGE_PLUGIN_API_VERSION>().toEqualTypeOf<1>()
    expectTypeOf<typeof SUPPORTED_OPENFORGE_API_VERSIONS[number]>().toEqualTypeOf<1>()
  })

  it('derives TypeScript validator constants from schema enum values', async () => {
    expect(OPENFORGE_PLUGIN_CAPABILITIES).toEqual(OPENFORGE_PACKAGE_METADATA_SCHEMA.properties.requires.items.enum)
    expect(SUPPORTED_OPENFORGE_API_VERSIONS).toEqual(OPENFORGE_PACKAGE_METADATA_SCHEMA.properties.apiVersion.enum)

    const schemaWithNewApiVersion = structuredClone(OPENFORGE_PACKAGE_METADATA_SCHEMA)
    schemaWithNewApiVersion.properties.apiVersion = { enum: [1, 2] }

    vi.resetModules()
    vi.doMock('./openforgePackageMetadataSchema.json', () => ({ default: schemaWithNewApiVersion }))

    const manifest = await import('./manifest')

    expect(manifest.OPENFORGE_PLUGIN_CAPABILITIES).toEqual(schemaWithNewApiVersion.properties.requires.items.enum)
    expect(manifest.isSupportedOpenForgeApiVersion(2)).toBe(true)
    expect(manifest.validateOpenForgePackageMetadata(validMetadata({
      apiVersion: 2,
    }))).toEqual([])
  })

  it('fails fast when the public capability type diverges from the schema', async () => {
    const schemaWithNewCapability = structuredClone(OPENFORGE_PACKAGE_METADATA_SCHEMA)
    schemaWithNewCapability.properties.requires.items.enum = [
      ...OPENFORGE_PACKAGE_METADATA_SCHEMA.properties.requires.items.enum,
      'schemaOnlyCapability',
    ]

    vi.resetModules()
    vi.doMock('./openforgePackageMetadataSchema.json', () => ({ default: schemaWithNewCapability }))

    await expect(import('./manifest')).rejects.toThrow('OpenForgePluginCapability must match')
  })

  it('documents every capability from the canonical package metadata schema', () => {
    const reference = readFileSync(resolve(import.meta.dirname, '../../../docs/plugins/sdk-reference.md'), 'utf8')
    const capabilitySection = reference.match(/Supported `requires` capabilities are:\s+```ts\n(?<union>[\s\S]*?)\n```/)

    expect(capabilitySection?.groups?.union).toBeDefined()

    const documentedCapabilities = [...capabilitySection!.groups!.union.matchAll(/'([^']+)'/g)]
      .map(([, capability]) => capability)

    expect(documentedCapabilities).toEqual(OPENFORGE_PACKAGE_METADATA_SCHEMA.properties.requires.items.enum)
  })
})
