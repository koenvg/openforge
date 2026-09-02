import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import viteConfig from '../vite.config.ts'
import { OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS } from '../packages/plugin-sdk/src/publicUiExports.mjs'
import { OPENFORGE_HOST_SHARED_SVELTE_IMPORTS, OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS } from '../packages/plugin-sdk/src/vite.ts'
import {
  OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS,
  SVELTE_HOST_RUNTIME_MODULES,
  rendererImportMapHtml,
  rendererImportMapScriptBody,
  rendererImportMapScriptHashSource,
  svelteHostRuntimeBuildEntries,
  svelteHostRuntimeImportMapEntries,
  terminalRuntimeImportMapEntries,
} from '../packages/plugin-sdk/src/svelteHostRuntimeContract.mjs'

function isSpecifierExternalized(external, id) {
  if (typeof external === 'function') return external(id, undefined, false) === true
  if (Array.isArray(external)) return external.includes(id)
  return false
}

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

    expect(resolveAliasReplacement(aliases, '@openforge-app/plugin-sdk')).toBe(
      resolve(process.cwd(), 'packages/plugin-sdk/src/index.ts'),
    )
    expect(resolveAliasReplacement(aliases, '@openforge-app/plugin-sdk/frontend')).toBe(
      resolve(process.cwd(), 'packages/plugin-sdk/src/frontend.ts'),
    )
  })

  it('derives host renderer aliases for every canonical plugin SDK UI export', () => {
    const aliases = viteConfig.resolve?.alias

    for (const { importSpecifier, workspaceSourcePath } of OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS) {
      expect(resolveAliasReplacement(aliases, importSpecifier), importSpecifier).toBe(
        resolve(process.cwd(), workspaceSourcePath),
      )
    }
  })

  it('builds a packed external plugin against the shared host Svelte runtime', async () => {
    const contractScript = await readFile(
      join(process.cwd(), 'packages/plugin-sdk/scripts/check-published-contract.mjs'),
      'utf8',
    )

    expect(contractScript).toContain('buildPackedExternalPluginFixture')
    expect(contractScript).toContain('openforgePluginViteExternals')
    for (const componentName of ['Modal', 'Select', 'Tabs', 'AnchoredMenu', 'Tooltip']) {
      const registration = OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS.find(
        candidate => candidate.componentName === componentName,
      )
      expect(registration, componentName).toBeTruthy()
      expect(contractScript, componentName).toContain(registration.importSpecifier)
    }
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

  it('externalizes host-runtime Svelte in the host renderer build so host and external plugins share one Svelte instance', () => {
    // Root cause of effect_orphan for external plugins: the host bundled its OWN Svelte
    // (instance A) while external plugins resolve Svelte through the injected import map
    // to plugin://host-runtime/svelte (instance B). Externalizing the host-runtime Svelte
    // specifiers makes the host emit bare `svelte` imports resolved through that same import
    // map, so PluginSlot (host) and the mounted plugin component share ONE Svelte instance.
    //
    // This is a contract test, not a render test: the effect_orphan crash only manifests
    // with TWO distinct Svelte module realms, which cannot exist in a single-instance Vitest
    // environment — a render test would pass with OR without the fix. The behavioural proof
    // (built host bundle emits bare svelte imports and no longer inlines Svelte internals)
    // lives in the real `pnpm build` verification for this change.
    const external = viteConfig.build?.rolldownOptions?.external
    expect(external, 'host renderer build must configure rolldownOptions.external').toBeTruthy()

    const importMap = svelteHostRuntimeImportMapEntries()
    for (const specifier of OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS) {
      expect(
        isSpecifierExternalized(external, specifier),
        `${specifier} must be externalized by the host renderer build`,
      ).toBe(true)
      // Closing the loop: an externalized bare import is only safe if the renderer import map
      // resolves it at runtime to the shared plugin://host-runtime/svelte instance.
      expect(
        importMap[specifier],
        `${specifier} is externalized but has no plugin://host-runtime/svelte import-map target`,
      ).toMatch(/^plugin:\/\/host-runtime\/svelte\//)
    }

    // Guard against over-externalization: only the Svelte host-runtime specifiers should be
    // externalized. Application code, relative imports, and unrelated packages stay bundled.
    for (const nonSvelte of ['react', 'svelte-not-a-real-submodule', './foo', '../bar', '@openforge-app/terminal-runtime']) {
      expect(
        isSpecifierExternalized(external, nonSvelte),
        `${nonSvelte} must NOT be externalized by the host renderer build`,
      ).toBe(false)
    }
  })

  it('injects the renderer import map from the shared contract through Vite', async () => {
    const plugin = viteConfig.plugins.find(candidate => candidate?.name === 'openforge-host-runtime-import-map')
    expect(plugin).toBeTruthy()
    const transformed = plugin.transformIndexHtml(await readFile(join(process.cwd(), 'index.html'), 'utf8'))

    expect(readRendererImportMapScriptBody(transformed)).toBe(rendererImportMapScriptBody())
    expect(readRendererImportMap(transformed)).toEqual({
      ...svelteHostRuntimeImportMapEntries(),
      '@openforge-app/plugin-sdk': 'plugin://host-runtime/plugin-sdk/index.js',
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
        "import { openforgePluginViteExternals } from '@openforge-app/plugin-sdk/vite'",
      )
      expect(viteConfig, `${pluginName} must externalize via the official helper`).toContain(
        'external: openforgePluginViteExternals',
      )
      expect(packageJson.peerDependencies?.svelte, `${pluginName} must share host Svelte as a peer`).toBeTruthy()
      expect(packageJson.devDependencies?.svelte, `${pluginName} must keep Svelte available for author-time compilation`).toBeTruthy()
    }
  })

})
