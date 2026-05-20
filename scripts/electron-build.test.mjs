import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { build as viteBuild } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS, openforgePluginViteExternals } from '../packages/plugin-sdk/src/vite.ts'
import { handlePluginProtocolRequest } from '../src/electron/pluginProtocol.ts'
import { buildSvelteHostRuntimeAssets, copyHostRuntimeAssets, svelteHostRuntimeImportMapEntries } from './electron-build.mjs'

async function writeMinimalHostRuntimeInputs(repoRoot) {
  await mkdir(join(repoRoot, 'packages', 'plugin-sdk', 'src'), { recursive: true })
  await mkdir(join(repoRoot, 'packages', 'plugin-runtime', 'src'), { recursive: true })
  await mkdir(join(repoRoot, 'src-tauri', 'plugin-host'), { recursive: true })
  await writeFile(join(repoRoot, 'packages', 'plugin-sdk', 'src', 'index.ts'), 'export const pluginSdk = true;')
  await writeFile(join(repoRoot, 'packages', 'plugin-runtime', 'src', 'commandValidation.ts'), 'export function validateSchemaValue() { return { valid: true, bundledRuntimeMarker: true }; }')
  await writeFile(join(repoRoot, 'src-tauri', 'plugin-host', 'index.ts'), "import { validateSchemaValue } from '@openforge/plugin-runtime/commandValidation'\nconsole.log(validateSchemaValue())\n")

  const svelteFiles = {
    'index-client.js': 'export const svelte = true;',
    'animate/index.js': 'export const animate = true;',
    'attachments/index.js': 'export const attachments = true;',
    'easing/index.js': 'export const easing = true;',
    'events/index.js': 'export const events = true;',
    'internal/index.js': 'export const internal = true;',
    'internal/client/index.js': 'export const internalClient = true;',
    'internal/disclose-version.js': 'export const discloseVersion = true;',
    'internal/flags/async.js': 'export const asyncFlag = true;',
    'internal/flags/legacy.js': 'export const legacyFlag = true;',
    'internal/flags/tracing.js': 'export const tracingFlag = true;',
    'legacy/legacy-client.js': 'export const legacy = true;',
    'motion/index.js': 'export const motion = true;',
    'reactivity/index-client.js': 'export const reactivity = true;',
    'reactivity/window/index.js': 'export const reactiveWindow = true;',
    'store/index-client.js': 'export const store = true;',
    'transition/index.js': 'export const transition = true;',
  }
  for (const [relPath, content] of Object.entries(svelteFiles)) {
    const filePath = join(repoRoot, 'node_modules', 'svelte', 'src', relPath)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }
}

async function writeMinimalSveltePlugin(root) {
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'TaskSchedulerView.svelte'), `<script lang="ts">\n  export let name: string = 'Scheduler'\n</script>\n<div>{name}</div>\n`)
  await writeFile(join(root, 'src', 'index.ts'), `import TaskSchedulerView from './TaskSchedulerView.svelte'\n\nconst plugin = {\n  activate(_api, registry) {\n    registry.registerView({ id: 'task-scheduler', title: 'Task Scheduler', component: TaskSchedulerView })\n  },\n}\n\nObject.defineProperty(plugin, '__openforgeFrontendPlugin', { value: true })\n\nexport default plugin\n`)
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
      minify: false,
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
  return Array.from(code.matchAll(/(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g), match => match[1])
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

describe('Electron build host-runtime assets', () => {
  it('keeps the Svelte host-runtime contract aligned across externals, import map, and assets', async () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const imports = readRendererImportMap(await readFile(join(repoRoot, 'index.html'), 'utf8'))
    const expectedSvelteImports = svelteHostRuntimeImportMapEntries()
    const actualSvelteImports = Object.fromEntries(
      Object.entries(imports).filter(([specifier]) => specifier === 'svelte' || specifier.startsWith('svelte/')),
    )

    expect(actualSvelteImports).toEqual(expectedSvelteImports)
    expect([...OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS].sort()).toEqual(Object.keys(expectedSvelteImports).sort())
  })

  it('bundles Svelte host runtime entrypoints without unresolved package-private imports', async () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const outDir = join(tmpdir(), `openforge-svelte-runtime-${process.pid}-${Date.now()}`)

    await buildSvelteHostRuntimeAssets(repoRoot, outDir)

    const internalClient = await readFile(join(outDir, 'internal', 'client', 'index.js'), 'utf8')
    expect(internalClient).not.toMatch(/^\s*import\s+.*from\s+['\"](?:#|esm-env|clsx|svelte)/m)
    expect(internalClient).not.toMatch(/^\s*export\s+.*from\s+['\"](?:#|esm-env|clsx|svelte)/m)
  })

  it('resolves Svelte plugin bundle runtime imports through the renderer import map and host protocol', async () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const pluginRoot = join(tmpdir(), `openforge-svelte-plugin-${process.pid}-${Date.now()}`)
    const hostRuntimeRoot = join(tmpdir(), `openforge-plugin-host-runtime-${process.pid}-${Date.now()}`)

    try {
      const bundle = await buildMinimalSveltePluginBundle(pluginRoot)
      const svelteImports = staticModuleSpecifiers(bundle).filter(specifier => specifier === 'svelte' || specifier.startsWith('svelte/'))
      const imports = readRendererImportMap(await readFile(join(repoRoot, 'index.html'), 'utf8'))

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

  it('generates plugin SDK, bundles backend plugin-host runtime dependencies, and builds browser-ready Svelte host-runtime assets into dist-electron resources', async () => {
    const repoRoot = join(tmpdir(), `openforge-electron-build-${process.pid}-${Date.now()}`)
    const outDir = join(repoRoot, 'dist-electron')
    await writeMinimalHostRuntimeInputs(repoRoot)

    await copyHostRuntimeAssets(repoRoot, outDir)

    await expect(stat(join(outDir, 'plugin-host', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'plugin-sdk', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'internal.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'internal', 'client', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'internal', 'flags', 'async.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'reactivity', 'window', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'svelte', 'store.js'))).resolves.toBeTruthy()
    const backendHost = await readFile(join(outDir, 'plugin-host', 'index.js'), 'utf8')
    expect(backendHost).toContain('bundledRuntimeMarker')
    expect(backendHost).not.toContain('@openforge/plugin-runtime')
    await expect(readFile(join(outDir, 'plugin-host', 'plugin-sdk', 'index.js'), 'utf8')).resolves.toContain('pluginSdk')
    await expect(readFile(join(outDir, 'plugin-host', 'svelte', 'index.js'), 'utf8')).resolves.toContain('svelte')
    await expect(readFile(join(outDir, 'plugin-host', 'svelte', 'internal.js'), 'utf8')).resolves.toContain('internal')
    await expect(readFile(join(outDir, 'plugin-host', 'svelte', 'store.js'), 'utf8')).resolves.toContain('store')
  })
})
