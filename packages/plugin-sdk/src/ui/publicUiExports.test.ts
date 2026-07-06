import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('plugin-sdk public UI exports', () => {
  const packageRoot = resolve(import.meta.dirname, '../..')

  it('exports Modal only through the public SDK UI package path', () => {
    const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }

    expect(packageJson.exports['./ui/Modal.svelte']).toBe('./dist/ui/Modal.svelte')
  })

  it('copies the Modal Svelte asset into the package dist during build', () => {
    const copyScript = readFileSync(resolve(packageRoot, 'scripts/copy-package-assets.mjs'), 'utf8')

    expect(copyScript).toContain('src/ui/Modal.svelte')
  })

  it('includes Modal in source aliases used by plugin tests and development', () => {
    const viteSource = readFileSync(resolve(packageRoot, 'src/vite.ts'), 'utf8')

    expect(viteSource).toContain("@openforge-app/plugin-sdk/ui/Modal.svelte")
    expect(viteSource).toContain('packages/plugin-sdk/src/ui/Modal.svelte')
  })
})
