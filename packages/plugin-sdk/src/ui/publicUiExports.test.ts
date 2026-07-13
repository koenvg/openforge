import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('plugin-sdk public UI exports', () => {
  const packageRoot = resolve(import.meta.dirname, '../..')
  const publicUiComponents = ['Button', 'Modal', 'PluginPageHeader', 'PluginViewState'] as const

  it('exports stable Svelte UI components through public SDK UI package paths', () => {
    const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }

    for (const componentName of publicUiComponents) {
      expect(packageJson.exports[`./ui/${componentName}.svelte`]).toBe(`./dist/ui/${componentName}.svelte`)
    }
  })

  it('copies stable Svelte UI assets into the package dist during build', () => {
    const copyScript = readFileSync(resolve(packageRoot, 'scripts/copy-package-assets.mjs'), 'utf8')

    for (const componentName of publicUiComponents) {
      expect(copyScript).toContain(`src/ui/${componentName}.svelte`)
    }
  })

  it('includes stable Svelte UI components in source aliases used by plugin tests and development', () => {
    const viteSource = readFileSync(resolve(packageRoot, 'src/vite.ts'), 'utf8')

    for (const componentName of publicUiComponents) {
      expect(viteSource).toContain(`@openforge-app/plugin-sdk/ui/${componentName}.svelte`)
      expect(viteSource).toContain(`packages/plugin-sdk/src/ui/${componentName}.svelte`)
    }
  })

  it('allows stable Svelte UI components through the plugin import-boundary fallback', () => {
    const boundaryScript = readFileSync(resolve(packageRoot, '../../scripts/check-plugin-import-boundaries.mjs'), 'utf8')

    for (const componentName of publicUiComponents) {
      expect(boundaryScript).toContain(`'/ui/${componentName}.svelte'`)
    }
  })
})
