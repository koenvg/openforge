import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createPackagedSmokeEnv,
  formatHealthFailure,
  packagedAppExecutablePath,
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
