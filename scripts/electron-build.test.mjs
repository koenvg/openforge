import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildSvelteHostRuntimeAssets, copyHostRuntimeAssets } from './electron-build.mjs'

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

describe('Electron build host-runtime assets', () => {
  it('bundles Svelte host runtime entrypoints without unresolved package-private imports', async () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const outDir = join(tmpdir(), `openforge-svelte-runtime-${process.pid}-${Date.now()}`)

    await buildSvelteHostRuntimeAssets(repoRoot, outDir)

    const internalClient = await readFile(join(outDir, 'internal', 'client', 'index.js'), 'utf8')
    expect(internalClient).not.toMatch(/^\s*import\s+.*from\s+['\"](?:#|esm-env|clsx|svelte)/m)
    expect(internalClient).not.toMatch(/^\s*export\s+.*from\s+['\"](?:#|esm-env|clsx|svelte)/m)
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
