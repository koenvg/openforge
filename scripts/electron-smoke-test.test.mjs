import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ARTIFACTS_DIR,
  DEFAULT_SMOKE_PORT,
  electronSmokeLaunchOptions,
  openForgeCliBridgePath,
  packagedElectronAppRootPath,
  parseSmokeArgs,
  smokeBuildSteps,
  smokeLaunchEnv,
  runCli,
} from './electron-smoke-test.mjs'

const repoRoot = join(import.meta.dirname, '..')

describe('Electron smoke script contract', () => {
  it('builds the packaged Electron app by default and supports a verification-only skip flag', () => {
    expect(smokeBuildSteps({ skipBuild: false })).toEqual([
      { command: 'pnpm', args: ['electron:package'] },
    ])
    expect(smokeBuildSteps({ skipBuild: true })).toEqual([])
    expect(parseSmokeArgs(['--skip-build'], {})).toMatchObject({ skipBuild: true })
    expect(parseSmokeArgs(['--', '--skip-build'], {})).toMatchObject({ skipBuild: true })
  })

  it('uses deterministic local artifact and bridge port defaults with env overrides only where explicit', () => {
    expect(parseSmokeArgs([], {})).toEqual({
      skipBuild: false,
      artifactsDir: DEFAULT_ARTIFACTS_DIR,
    })
    expect(parseSmokeArgs(['--artifacts-dir', 'custom-artifacts'], {})).toEqual({
      skipBuild: false,
      artifactsDir: 'custom-artifacts',
    })
    expect(DEFAULT_SMOKE_PORT).toBe(17652)
  })

  it('launches with isolated data directories, smoke dialog suppression, and matching CLI/sidecar ports', () => {
    const env = smokeLaunchEnv({
      env: {
        PATH: '/usr/bin',
        ELECTRON_RENDERER_URL: 'http://127.0.0.1:1420',
        OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR: '1',
        OPENFORGE_SIDECAR_PATH: '/tmp/stale-sidecar',
      },
      port: 19999,
      userDataDir: '/tmp/openforge-electron-user',
      appDataDir: '/tmp/openforge-sidecar-data',
    })

    expect(env).toMatchObject({
      PATH: '/usr/bin',
      OPENFORGE_BACKEND_PORT: '19999',
      OPENFORGE_HTTP_PORT: '19999',
      OPENFORGE_ELECTRON_SMOKE_TEST: '1',
      OPENFORGE_ELECTRON_USER_DATA_DIR: '/tmp/openforge-electron-user',
      OPENFORGE_APP_DATA_DIR: '/tmp/openforge-sidecar-data',
    })
    expect(env).not.toHaveProperty('ELECTRON_RENDERER_URL')
    expect(env).not.toHaveProperty('OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR')
    expect(env).not.toHaveProperty('OPENFORGE_SIDECAR_PATH')
  })

  it('launches the packaged app root with Playwright args and verifies the bundled OpenForge CLI bridge', () => {
    const appPath = '/tmp/Open Forge.app'
    const appRoot = packagedElectronAppRootPath(appPath)
    const launchOptions = electronSmokeLaunchOptions({
      appRoot,
      root: '/repo',
      env: { PATH: '/usr/bin' },
      artifactsDir: '/artifacts',
      videosDir: '/artifacts/videos',
      tracesDir: '/artifacts/traces',
    })

    expect(appRoot).toBe('/tmp/Open Forge.app/Contents/Resources/app')
    expect(launchOptions).toMatchObject({
      args: [appRoot],
      cwd: '/repo',
      env: { PATH: '/usr/bin' },
      artifactsDir: '/artifacts',
      recordVideo: { dir: '/artifacts/videos' },
      tracesDir: '/artifacts/traces',
    })
    expect(launchOptions).not.toHaveProperty('executablePath')
    expect(openForgeCliBridgePath(appPath)).toBe('/tmp/Open Forge.app/Contents/Resources/openforge-cli/cli.js')
  })

  it('starts Playwright tracing/video and writes Electron logs, screenshots, and traces on failure', async () => {
    const script = await readFile(join(repoRoot, 'scripts/electron-smoke-test.mjs'), 'utf8')

    expect(script).toContain("recordVideo: { dir: videosDir }")
    expect(script).toContain('tracing.start({ screenshots: true, snapshots: true })')
    expect(script).toContain("page.screenshot({ path: join(artifactsDir, 'failure.png')")
    expect(script).toContain("writeFile(join(artifactsDir, 'electron.log')")
    expect(script).toContain("tracing.stop({ path: join(artifactsDir, 'trace.zip')")
  })

  it('bounds hung CLI bridge probes with a process timeout', async () => {
    await expect(
      runCli(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { timeoutMs: 25 }),
    ).rejects.toThrow('timed out after 25ms')
  })

  it('treats Electron close as part of the smoke success path', async () => {
    const script = await readFile(join(repoRoot, 'scripts/electron-smoke-test.mjs'), 'utf8')

    expect(script).toContain("log('[electron] closing app')\n    await electronApp.close()\n    electronApp = null\n    succeeded = true")
  })
})
