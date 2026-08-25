import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPreloadBundle, copyElectronMainRuntimeAssets } from './electron-build.mjs'
import { removeTemporaryTestPaths, repoRoot, temporaryTestPath } from './electron-build.test-fixtures.mjs'

describe('Electron build preload assets', () => {
  afterEach(removeTemporaryTestPaths)
  it('excludes Vitest-only Electron helpers from the production compilation graph', () => {
    const configPath = join(repoRoot, 'tsconfig.electron.json')
    const tscPath = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')
    const productionSources = execFileSync(
      process.execPath,
      [tscPath, '--project', configPath, '--listFilesOnly'],
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim().split(/\r?\n/)
    expect(productionSources).toContain(join(repoRoot, 'src', 'electron', 'main.ts'))
    expect(productionSources.some(file => file.endsWith('.testUtils.ts'))).toBe(false)
    expect(productionSources.some(file => file.includes('/node_modules/vitest/'))).toBe(false)
  })

  it('copies shared runtime assets next to compiled Electron main assets', async () => {
    const outDir = temporaryTestPath('electron-main-runtime')
    await mkdir(outDir, { recursive: true })

    await copyElectronMainRuntimeAssets(repoRoot, outDir)

    const copiedContract = await readFile(join(outDir, 'svelteHostRuntimeContract.mjs'), 'utf8')
    expect(copiedContract).toContain('SVELTE_HOST_RUNTIME_MODULES')
    expect(copiedContract).not.toContain('packages/plugin-sdk')

    const copiedPreloadBridge = await readFile(join(outDir, 'preloadBridge.cjs'), 'utf8')
    expect(copiedPreloadBridge).toContain('createOpenForgePreloadApi')
    expect(copiedPreloadBridge).toContain('openforge:event')
  })

  it('bundles the sandbox preload into a self-contained preload.cjs', async () => {
    // Electron's sandboxed preload uses a restricted require that cannot resolve
    // relative sibling modules, so the bridge must be inlined into preload.cjs
    // rather than pulled in via `require('./preloadBridge.cjs')` at runtime.
    const outDir = temporaryTestPath('preload-bundle')
    await mkdir(outDir, { recursive: true })

    try {
      await buildPreloadBundle(repoRoot, outDir)

      const preload = await readFile(join(outDir, 'preload.cjs'), 'utf8')
      expect(preload).toContain('createOpenForgePreloadApi')
      expect(preload).toContain('openforge:invoke')
      expect(preload).toContain('exposeInMainWorld')
      expect(preload).not.toMatch(/require\(\s*['"]\.\/preloadBridge\.cjs['"]\s*\)/)
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  })
})
