import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import viteConfig from '../vite.config.ts'
import { OPENFORGE_HOST_SHARED_SVELTE_IMPORTS } from '../packages/plugin-sdk/src/vite.ts'
import {
  SVELTE_HOST_RUNTIME_MODULES,
  rendererImportMapHtml,
  svelteHostRuntimeBuildEntries,
  svelteHostRuntimeImportMapEntries,
} from '../packages/plugin-sdk/src/svelteHostRuntimeContract.mjs'

function readRendererImportMap(indexHtml) {
  const importMapJson = indexHtml.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/)?.[1]
  expect(importMapJson).toBeTruthy()
  return JSON.parse(importMapJson).imports
}

describe('OpenForge plugin Svelte runtime contract', () => {
  it('keeps the plugin SDK Vite helper package-self-contained', async () => {
    const viteHelper = await readFile(join(process.cwd(), 'packages/plugin-sdk/src/vite.ts'), 'utf8')

    expect(viteHelper).toContain("from './svelteHostRuntimeContract.mjs'")
    expect(viteHelper).not.toContain('src/electron')
    expect(viteHelper).not.toContain('../../../')
  })

  it('keeps the renderer import map complete for every SDK-externalized Svelte runtime import', async () => {
    const imports = readRendererImportMap(rendererImportMapHtml())

    expect(imports).toMatchObject(svelteHostRuntimeImportMapEntries())
    expect([...OPENFORGE_HOST_SHARED_SVELTE_IMPORTS].sort()).toEqual(
      SVELTE_HOST_RUNTIME_MODULES.map(module => module.specifier).sort(),
    )
    expect(Object.keys(svelteHostRuntimeBuildEntries()).sort()).toEqual(
      SVELTE_HOST_RUNTIME_MODULES.map(module => module.assetPath.replace(/\.js$/, '')).sort(),
    )

    for (const specifier of OPENFORGE_HOST_SHARED_SVELTE_IMPORTS) {
      expect(imports[specifier], `${specifier} must be mapped by the host renderer import map`).toBeTruthy()
      expect(imports[specifier]).toMatch(/^plugin:\/\/host-runtime\/svelte\//)
    }
  })

  it('injects the renderer import map from the shared contract through Vite', async () => {
    const plugin = viteConfig.plugins.find(candidate => candidate?.name === 'openforge-host-runtime-import-map')
    expect(plugin).toBeTruthy()
    const transformed = plugin.transformIndexHtml(await readFile(join(process.cwd(), 'index.html'), 'utf8'))

    expect(readRendererImportMap(transformed)).toEqual({
      ...svelteHostRuntimeImportMapEntries(),
      '@openforge/plugin-sdk': 'plugin://host-runtime/plugin-sdk/index.js',
    })
  })

  it('keeps built-in plugin packages on the SDK Vite host-shared Svelte template', async () => {
    const pluginsRoot = join(process.cwd(), 'plugins')
    const pluginNames = (await readdir(pluginsRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()

    expect(pluginNames.length).toBeGreaterThan(0)

    for (const pluginName of pluginNames) {
      const pluginRoot = join(pluginsRoot, pluginName)
      const [viteConfig, packageJsonText] = await Promise.all([
        readFile(join(pluginRoot, 'vite.config.ts'), 'utf8'),
        readFile(join(pluginRoot, 'package.json'), 'utf8'),
      ])
      const packageJson = JSON.parse(packageJsonText)

      expect(viteConfig, `${pluginName} must import the official SDK Vite external helper`).toContain(
        "import { openforgePluginViteExternals } from '@openforge/plugin-sdk/vite'",
      )
      expect(viteConfig, `${pluginName} must externalize via the official helper`).toContain(
        'external: openforgePluginViteExternals',
      )
      expect(packageJson.peerDependencies?.svelte, `${pluginName} must share host Svelte as a peer`).toBeTruthy()
      expect(packageJson.devDependencies?.svelte, `${pluginName} must keep Svelte available for author-time compilation`).toBeTruthy()
    }
  })

  it('documents host-shared Svelte as the official plugin SDK/Vite template contract', async () => {
    const adr = await readFile(join(process.cwd(), 'docs/adr/0002-openforge-plugin-package-runtime.md'), 'utf8')

    expect(adr).toContain('Official contract: host-shared Svelte')
    expect(adr).toContain('OPENFORGE_HOST_SHARED_SVELTE_IMPORTS')
    expect(adr).toContain('svelte/internal/disclose-version')
    expect(adr).toContain('external: openforgePluginViteExternals')
  })
})
