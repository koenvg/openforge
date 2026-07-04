import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import viteConfig from '../vite.config.ts'
import { OPENFORGE_HOST_SHARED_SVELTE_IMPORTS, OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS } from '../packages/plugin-sdk/src/vite.ts'
import {
  SVELTE_HOST_RUNTIME_MODULES,
  rendererImportMapHtml,
  rendererImportMapScriptBody,
  rendererImportMapScriptHashSource,
  svelteHostRuntimeBuildEntries,
  svelteHostRuntimeImportMapEntries,
  terminalRuntimeImportMapEntries,
} from '../packages/plugin-sdk/src/svelteHostRuntimeContract.mjs'

function readRendererImportMapScriptBody(indexHtml) {
  const importMapBody = indexHtml.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1]
  expect(importMapBody).toBeTruthy()
  return importMapBody
}

function readRendererImportMap(indexHtml) {
  return JSON.parse(readRendererImportMapScriptBody(indexHtml)).imports
}

function resolveAliasReplacement(alias, specifier) {
  const entries = Array.isArray(alias)
    ? alias
    : Object.entries(alias ?? {}).map(([find, replacement]) => ({ find, replacement }))

  return entries.find(entry => {
    if (entry.find instanceof RegExp) return entry.find.test(specifier)
    return entry.find === specifier
  })?.replacement
}

describe('OpenForge plugin Svelte runtime contract', () => {
  it('keeps the plugin SDK Vite helper package-self-contained', async () => {
    const viteHelper = await readFile(join(process.cwd(), 'packages/plugin-sdk/src/vite.ts'), 'utf8')

    expect(viteHelper).toContain("from './svelteHostRuntimeContract.mjs'")
    expect(viteHelper).not.toContain('src/electron')
    expect(viteHelper).not.toContain('../../../')
  })

  it('aliases plugin SDK source entrypoints for host-bundled built-in plugins', async () => {
    const aliases = viteConfig.resolve?.alias

    expect(resolveAliasReplacement(aliases, '@openforge/plugin-sdk')).toBe(
      resolve(process.cwd(), 'packages/plugin-sdk/src/index.ts'),
    )
    expect(resolveAliasReplacement(aliases, '@openforge/plugin-sdk/frontend')).toBe(
      resolve(process.cwd(), 'packages/plugin-sdk/src/frontend.ts'),
    )
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

    for (const specifier of OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS) {
      expect(imports[specifier], `${specifier} must be mapped by the host renderer import map`).toBeTruthy()
      expect(imports[specifier]).toMatch(/^plugin:\/\/host-runtime\/terminal-runtime\//)
    }
  })

  it('injects the renderer import map from the shared contract through Vite', async () => {
    const plugin = viteConfig.plugins.find(candidate => candidate?.name === 'openforge-host-runtime-import-map')
    expect(plugin).toBeTruthy()
    const transformed = plugin.transformIndexHtml(await readFile(join(process.cwd(), 'index.html'), 'utf8'))

    expect(readRendererImportMapScriptBody(transformed)).toBe(rendererImportMapScriptBody())
    expect(readRendererImportMap(transformed)).toEqual({
      ...svelteHostRuntimeImportMapEntries(),
      '@openforge/plugin-sdk': 'plugin://host-runtime/plugin-sdk/index.js',
      ...terminalRuntimeImportMapEntries(),
    })
  })

  it('derives the renderer import-map CSP hash from the exact injected script body', () => {
    const body = readRendererImportMapScriptBody(rendererImportMapHtml())
    const expectedHashSource = `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`

    expect(body).toBe(rendererImportMapScriptBody())
    expect(rendererImportMapScriptHashSource()).toBe(expectedHashSource)
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
