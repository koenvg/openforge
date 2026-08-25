import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildBackendPluginHostRuntime, copyHostRuntimeAssets } from './electron-build.mjs'
import { writeMinimalHostRuntimeInputs } from './electron-build-host-runtime.test-fixtures.mjs'
import { removeTemporaryTestPaths, temporaryTestPath } from './electron-build.test-fixtures.mjs'

describe('Electron build plugin-host bundling', () => {
  afterEach(removeTemporaryTestPaths)
  it('builds the backend plugin-host runtime from workspace sources without generated package artifacts', async () => {
    const repoRoot = temporaryTestPath('electron-build-alt-backend')
    const outDir = join(repoRoot, 'dist-electron', 'plugin-host')
    await writeMinimalHostRuntimeInputs(repoRoot, { backendCrateRoot: 'crates/openforge-backend' })
    await expect(stat(join(repoRoot, 'packages', 'plugin-sdk', 'dist', 'index.js'))).rejects.toMatchObject({ code: 'ENOENT' })

    await buildBackendPluginHostRuntime(repoRoot, outDir)

    const backendHost = await readFile(join(outDir, 'index.js'), 'utf8')
    expect(backendHost).toContain('bundledRuntimeMarker')
    expect(backendHost).toContain('resolveExternalTextFileChunkSize')
    expect(backendHost).not.toContain('@openforge-app/plugin-runtime')
    expect(backendHost).not.toContain('@openforge-app/plugin-sdk')
  })

  it('generates plugin SDK and bundles backend plugin-host runtime dependencies into dist-electron resources', async () => {
    const repoRoot = temporaryTestPath('electron-build')
    const outDir = join(repoRoot, 'dist-electron')
    await writeMinimalHostRuntimeInputs(repoRoot)

    await copyHostRuntimeAssets(repoRoot, outDir)

    await expect(stat(join(outDir, 'plugin-host', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'plugin-sdk', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'terminal-runtime', 'index.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'terminal-runtime', 'shortcuts.js'))).resolves.toBeTruthy()
    await expect(stat(join(outDir, 'plugin-host', 'terminal-runtime', 'TerminalTabsShell.js'))).resolves.toBeTruthy()
    const backendHost = await readFile(join(outDir, 'plugin-host', 'index.js'), 'utf8')
    expect(backendHost).toContain('bundledRuntimeMarker')
    expect(backendHost).not.toContain('@openforge-app/plugin-runtime')
    await expect(readFile(join(outDir, 'plugin-host', 'plugin-sdk', 'index.js'), 'utf8')).resolves.toContain('pluginSdk')
    await expect(readFile(join(outDir, 'plugin-host', 'terminal-runtime', 'index.js'), 'utf8')).resolves.toContain('terminalRuntime')
  })
})
