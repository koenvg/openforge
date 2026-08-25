import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { build as viteBuild } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { get } from 'svelte/store'
import { OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS, openforgePluginViteExternals } from '../packages/plugin-sdk/src/vite.ts'
import { handlePluginProtocolRequest } from '../src/electron/pluginProtocol.ts'
import { activatePlugin } from '../src/lib/plugin/pluginRegistry.ts'
import { _resetPluginLoaderForTests, _setModuleLoader } from '../src/lib/plugin/pluginLoader.ts'
import { installedPlugins, enabledPluginIds, runtimeContributionSources } from '../src/lib/plugin/pluginStore.ts'
import { activeProjectId } from '../src/lib/stores.ts'
import { rendererImportMapHtml } from '../packages/plugin-sdk/src/svelteHostRuntimeContract.mjs'
import { buildSvelteHostRuntimeAssets, copyHostRuntimeAssets, svelteHostRuntimeImportMapEntries } from './electron-build.mjs'
import { writeMinimalHostRuntimeInputs } from './electron-build-host-runtime.test-fixtures.mjs'
import { repoRoot, temporaryTestPath } from './electron-build.test-fixtures.mjs'

const sidecarConfig = {
  command: 'openforge-sidecar',
  args: [],
  env: {},
  host: '127.0.0.1',
  port: 17642,
  token: 'secret-token',
  baseUrl: 'http://127.0.0.1:17642',
  healthUrl: 'http://127.0.0.1:17642/app/health',
  readinessUrl: 'http://127.0.0.1:17642/app/readiness',
  eventUrl: 'http://127.0.0.1:17642/app/events',
}

async function writeMinimalSveltePlugin(root) {
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'TaskSchedulerView.svelte'), `<script lang="ts">\n  import { onMount } from 'svelte'\n\n  export let name: string = 'Scheduler'\n  onMount(() => {})\n</script>\n<div>{name}</div>\n`)
  await writeFile(join(root, 'src', 'index.ts'), `import TaskSchedulerView from './TaskSchedulerView.svelte'\n\nconst plugin = {\n  activate(api) {\n    api.views.register({ id: 'task-scheduler', title: 'Task Scheduler', icon: 'calendar', component: TaskSchedulerView })\n  },\n}\n\nObject.defineProperty(plugin, '__openforgeFrontendPlugin', { value: true })\n\nexport default plugin\n`)
}

async function buildMinimalSveltePluginBundle(root) {
  await writeMinimalSveltePlugin(root)
  await viteBuild({
    configFile: false,
    root,
    publicDir: false,
    logLevel: 'silent',
    plugins: [svelte()],
    build: {
      emptyOutDir: true,
      outDir: join(root, 'dist'),
      lib: {
        entry: join(root, 'src', 'index.ts'),
        formats: ['es'],
        fileName: () => 'frontend.js',
      },
      minify: true,
      sourcemap: false,
      target: 'es2022',
      rollupOptions: {
        external: openforgePluginViteExternals,
      },
    },
  })

  return readFile(join(root, 'dist', 'frontend.js'), 'utf8')
}

function staticModuleSpecifiers(code) {
  return Array.from(code.matchAll(/\b(?:import|export)\s*(?:[^'"]*?\bfrom\s*)?['"]([^'"]+)['"]/g), match => match[1])
}

function readRendererImportMap(indexHtml) {
  const importMapJson = indexHtml.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/)?.[1]
  expect(importMapJson).toBeTruthy()
  return JSON.parse(importMapJson).imports
}

function resolveImportMapSpecifier(specifier, imports) {
  if (imports[specifier]) return imports[specifier]

  const prefix = Object.keys(imports)
    .filter(key => key.endsWith('/') && specifier.startsWith(key))
    .sort((a, b) => b.length - a.length)[0]
  return prefix ? `${imports[prefix]}${specifier.slice(prefix.length)}` : null
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function dataModule(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

function isAbsoluteModuleUrl(specifier) {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier)
}

function svelteHostRuntimeTestStub(url) {
  if (url === 'plugin://host-runtime/svelte/index.js') {
    return dataModule('export function onMount() {}')
  }
  if (url.startsWith('plugin://host-runtime/svelte/internal/client')) {
    return dataModule('export function from_html() { return () => ({}) }\nexport function add_locations(component) { return component }')
  }
  if (url.startsWith('plugin://host-runtime/svelte/')) {
    return dataModule('')
  }
  return null
}

function replaceModuleSpecifier(code, specifier, replacement) {
  return code.replace(new RegExp(`(["'])${escapeRegExp(specifier)}\\1`, 'g'), JSON.stringify(replacement))
}

function createProtocolBackedModuleLoader({ repoRoot, pluginId, pluginRoot, sidecarConfig }) {
  const moduleCache = new Map()
  const fetch = async () => new Response(JSON.stringify({
    value: {
      plugin_id: pluginId,
      asset_root: pluginRoot,
      is_builtin: false,
    },
  }), { status: 200 })

  async function loadModuleUrl(url) {
    const stub = svelteHostRuntimeTestStub(url)
    if (stub) return stub

    if (moduleCache.has(url)) return moduleCache.get(url)

    const loading = (async () => {
      const response = await handlePluginProtocolRequest(url, {
        workspaceRoot: repoRoot,
        sidecarConfig,
        fetch,
        readFile,
        realpath,
      })
      expect(response.status, `${url} should be served through plugin://`).toBe(200)
      let code = await response.text()
      for (const specifier of staticModuleSpecifiers(code)) {
        if (!isAbsoluteModuleUrl(specifier) && !specifier.startsWith('./') && !specifier.startsWith('../') && !specifier.startsWith('/')) {
          throw new Error(`Unresolved bare import ${specifier} in ${url}`)
        }
        const resolved = isAbsoluteModuleUrl(specifier)
          ? specifier
          : new URL(specifier, url).toString()
        code = replaceModuleSpecifier(code, specifier, await loadModuleUrl(resolved))
      }
      return dataModule(code)
    })()

    moduleCache.set(url, loading)
    return loading
  }

  return async (url) => import(await loadModuleUrl(url))
}

describe('Electron build Svelte host-runtime integration', () => {
  afterEach(() => {
    _resetPluginLoaderForTests()
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    runtimeContributionSources.set(new Map())
    activeProjectId.set(null)
  })

  it('keeps the Svelte host-runtime contract aligned across externals, import map, and assets', async () => {
    const imports = readRendererImportMap(rendererImportMapHtml())
    const expectedSvelteImports = svelteHostRuntimeImportMapEntries()
    const actualSvelteImports = Object.fromEntries(
      Object.entries(imports).filter(([specifier]) => specifier === 'svelte' || specifier.startsWith('svelte/')),
    )

    expect(actualSvelteImports).toEqual(expectedSvelteImports)
    expect([...OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS].sort()).toEqual(Object.keys(expectedSvelteImports).sort())
  })

  it('bundles Svelte host runtime entrypoints without unresolved package-private imports', async () => {
    const outDir = temporaryTestPath('svelte-runtime')

    await buildSvelteHostRuntimeAssets(repoRoot, outDir)

    const internalClient = await readFile(join(outDir, 'internal', 'client', 'index.js'), 'utf8')
    expect(internalClient).not.toMatch(/^\s*import\s+.*from\s+['"](?:#|esm-env|clsx|svelte)/m)
    expect(internalClient).not.toMatch(/^\s*export\s+.*from\s+['"](?:#|esm-env|clsx|svelte)/m)
  })

  it('builds browser-ready Svelte host-runtime assets into dist-electron resources', async () => {
    const fixtureRoot = temporaryTestPath('electron-build-svelte-assets')
    const outDir = join(fixtureRoot, 'dist-electron')
    await writeMinimalHostRuntimeInputs(fixtureRoot)

    await copyHostRuntimeAssets(fixtureRoot, outDir)

    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'internal.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'internal', 'client', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'internal', 'flags', 'async.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'reactivity', 'window', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'store.js'))).resolves.toBeTruthy()
    await expect(readFile(join(outDir, 'plugin-host', 'svelte', 'index.js'), 'utf8')).resolves.toContain('svelte')
    await expect(readFile(join(outDir, 'plugin-host', 'svelte', 'internal.js'), 'utf8')).resolves.toContain('internal')
    await expect(readFile(join(outDir, 'plugin-host', 'svelte', 'store.js'), 'utf8')).resolves.toContain('store')
  })

  it('resolves Svelte plugin bundle runtime imports through the renderer import map and host protocol', async () => {
    const pluginRoot = temporaryTestPath('svelte-plugin')
    const hostRuntimeRoot = temporaryTestPath('plugin-host-runtime')

    try {
      const bundle = await buildMinimalSveltePluginBundle(pluginRoot)
      const svelteImports = staticModuleSpecifiers(bundle).filter(specifier => specifier === 'svelte' || specifier.startsWith('svelte/'))
      const imports = readRendererImportMap(rendererImportMapHtml())

      expect(svelteImports).toContain('svelte')
      expect(svelteImports).toContain('svelte/internal/client')
      expect(svelteImports).toContain('svelte/internal/disclose-version')

      await buildSvelteHostRuntimeAssets(repoRoot, join(hostRuntimeRoot, 'svelte'))

      for (const specifier of svelteImports) {
        const mappedUrl = resolveImportMapSpecifier(specifier, imports)
        expect(mappedUrl, `${specifier} must be covered by the renderer import map`).toBeTruthy()

        const response = await handlePluginProtocolRequest(mappedUrl, {
          workspaceRoot: repoRoot,
          hostRuntimeRoot,
          sidecarConfig: null,
          fetch: async () => new Response(null, { status: 404 }),
          readFile,
          realpath,
        })
        expect(response.status, `${specifier} resolved to ${mappedUrl}`).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('application/javascript')
      }
    } finally {
      await rm(pluginRoot, { recursive: true, force: true })
      await rm(hostRuntimeRoot, { recursive: true, force: true })
    }
  })

  it('activates a built Svelte plugin artifact through plugin protocol rewritten host runtime imports', async () => {
    const pluginId = 'com.example.task-scheduler'
    const pluginRoot = temporaryTestPath('svelte-plugin-enable')
    const hostRuntimeRoot = temporaryTestPath('plugin-host-runtime-enable')

    try {
      await buildMinimalSveltePluginBundle(pluginRoot)
      await buildSvelteHostRuntimeAssets(repoRoot, join(hostRuntimeRoot, 'svelte'))

      const pluginAssetResponse = await handlePluginProtocolRequest(`plugin://${pluginId}/dist/frontend.js`, {
        workspaceRoot: repoRoot,
        hostRuntimeRoot,
        sidecarConfig,
        fetch: async () => new Response(JSON.stringify({
          value: {
            plugin_id: pluginId,
            asset_root: pluginRoot,
            is_builtin: false,
          },
        }), { status: 200 }),
        readFile,
        realpath,
      })
      expect(pluginAssetResponse.status).toBe(200)
      const servedBundle = await pluginAssetResponse.text()
      const servedSpecifiers = staticModuleSpecifiers(servedBundle)
      expect(servedSpecifiers).toContain('plugin://host-runtime/svelte/index.js')
      expect(servedSpecifiers).toContain('plugin://host-runtime/svelte/internal/client/index.js')
      expect(servedSpecifiers).toContain('plugin://host-runtime/svelte/internal/disclose-version.js')
      expect(servedSpecifiers.filter(specifier => specifier === 'svelte' || specifier.startsWith('svelte/'))).toEqual([])

      for (const specifier of servedSpecifiers.filter(specifier => specifier.startsWith('plugin://host-runtime/svelte/'))) {
        const runtimeResponse = await handlePluginProtocolRequest(specifier, {
          workspaceRoot: repoRoot,
          hostRuntimeRoot,
          sidecarConfig: null,
          fetch: async () => new Response(null, { status: 404 }),
          readFile,
          realpath,
        })
        expect(runtimeResponse.status, `${specifier} must be provided by the host runtime`).toBe(200)
      }

      installedPlugins.set(new Map([[pluginId, {
        manifest: {
          id: pluginId,
          name: 'Task Scheduler',
          version: '1.0.0',
          apiVersion: '1.0.0',
          description: 'Schedules tasks',
          permissions: [],
          frontend: './dist/frontend.js',
          backend: null,
        },
        state: 'installed',
        error: null,
      }]]))
      enabledPluginIds.set(new Set([pluginId]))
      activeProjectId.set('project-1')
      _setModuleLoader(createProtocolBackedModuleLoader({ repoRoot, pluginId, pluginRoot, sidecarConfig }))

      await expect(activatePlugin(pluginId)).resolves.toBe(true)
      expect(get(installedPlugins).get(pluginId)).toMatchObject({ state: 'active', error: null })
      expect(get(runtimeContributionSources).get(pluginId)?.views?.[0]).toMatchObject({
        id: 'task-scheduler',
        title: 'Task Scheduler',
        icon: 'calendar',
      })
    } finally {
      await rm(pluginRoot, { recursive: true, force: true })
      await rm(hostRuntimeRoot, { recursive: true, force: true })
    }
  })
})
