import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  createPackagedSmokeEnv,
  forceKillPackagedApp,
  formatHealthFailure,
  packagedAppExecutablePath,
  packagedAppSpawnOptions,
} from './electron-packaged-smoke.mjs'

describe('Electron packaged runtime smoke helpers', () => {
  it('launches packaged runtime with isolated app and Electron user data directories', () => {
    const env = createPackagedSmokeEnv({
      baseEnv: { PATH: '/usr/bin', OPENFORGE_APP_DATA_DIR: '/real/data', OPENFORGE_BACKEND_PORT: '17422' },
      runtimeRoot: '/tmp/openforge-packaged-smoke',
      backendPort: 38123,
    })

    expect(env.PATH).toBe('/usr/bin')
    expect(env.OPENFORGE_APP_DATA_DIR).toBe('/tmp/openforge-packaged-smoke/app-data')
    expect(env.OPENFORGE_BACKEND_PORT).toBe('38123')
    expect(env.OPENFORGE_ELECTRON_USER_DATA_DIR).toBe('/tmp/openforge-packaged-smoke/electron-user-data')
    expect(env.ELECTRON_ENABLE_LOGGING).toBe('1')
  })

  it('resolves the executable inside a packaged macOS .app bundle', () => {
    expect(packagedAppExecutablePath('/repo/Open Forge.app', 'darwin')).toBe(
      join('/repo/Open Forge.app', 'Contents', 'MacOS', 'Open Forge'),
    )
  })

  it('launches the packaged app in a separate process group on macOS', () => {
    expect(packagedAppSpawnOptions({
      repoRoot: '/repo',
      env: { PATH: '/usr/bin' },
      platform: 'darwin',
    })).toMatchObject({
      cwd: '/repo',
      env: { PATH: '/usr/bin' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  })

  it('force-kills the detached macOS app process group so descendants cannot leak', () => {
    const child = { pid: 42, kill: vi.fn() }
    const killProcess = vi.fn()

    forceKillPackagedApp(child, { platform: 'darwin', killProcess })

    expect(killProcess).toHaveBeenCalledWith(-42, 'SIGKILL')
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('prints an actionable diagnostic when the packaged app cannot be found', () => {
    const scriptPath = fileURLToPath(new URL('./electron-packaged-smoke.mjs', import.meta.url))
    const missingAppPath = join(process.cwd(), '__missing-packaged-smoke-app__')
    const result = spawnSync(process.execPath, [
      scriptPath,
      '--skip-package',
      '--app',
      missingAppPath,
    ], { encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`Packaged Electron app not found at ${missingAppPath}`)
    expect(result.stderr).toContain('Run pnpm electron:package first or omit --skip-package')
  })

  it('diagnoses a missing window.openforge as the packaged sandbox preload guardrail failure', () => {
    const message = formatHealthFailure({
      ok: false,
      step: 'preload-exposure',
      message: 'window.openforge is undefined',
      bridgeUnavailable: true,
      url: 'file:///repo/dist/index.html',
    })

    expect(message).toContain('Packaged Electron preload did not expose window.openforge')
    expect(message).toContain('sandbox preload bundle')
    expect(message).toContain('file:///repo/dist/index.html')
  })

  it('diagnoses backend invoke failures after confirming the preload bridge exists', () => {
    const message = formatHealthFailure({
      ok: false,
      step: 'backend-invoke',
      message: 'Rust sidecar command failed: database unavailable',
      bridgeUnavailable: false,
    })

    expect(message).toContain("window.openforge.invoke('get_projects') failed")
    expect(message).toContain('database unavailable')
    expect(message).not.toContain('preload did not expose')
  })
})
