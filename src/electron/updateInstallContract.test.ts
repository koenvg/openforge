// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import { cp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { UpdateAuthorizationStore } from './updateAuthorization.js'
import { cleanupUpdateBundles, updateBundleFixture } from './updateBundle.testUtils.js'

// Explicit opt-in builds the native fixture, not an installed helper or application.
const enabled = process.env.RUN_UPDATE_HELPER_CONTRACT === '1'
const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OPENFORGE_')))
let executable: string

describe.skipIf(!enabled)('Electron authorization to native install/recovery contract', () => {
  beforeAll(() => {
    const manifest = execFileSync(process.execPath, ['scripts/rust-sidecar-layout.mjs', 'update-helper-manifest-path'], { encoding: 'utf8', env: cleanEnvironment }).trim()
    const build = execFileSync('cargo', ['build', '--manifest-path', manifest, '--features', 'test-fixtures', '--example', 'install-transaction-fixture', '--message-format=json'], { encoding: 'utf8', env: cleanEnvironment, maxBuffer: 8 * 1024 ** 2 })
    const outputs = build.split('\n').filter(Boolean).map(line => JSON.parse(line))
    executable = outputs.find(row => row.reason === 'compiler-artifact' && row.target.name === 'install-transaction-fixture' && row.executable)?.executable
    if (!executable) throw new Error('Native updater fixture was not built')
  }, 120_000)

  afterEach(cleanupUpdateBundles)

  it('accepts real Electron authorization, replaces the complete bundle and recovers in a fresh process', async () => {
    const { root, source, store } = await updateBundleFixture()
    const destination = join(root, 'Installed.app')
    await cp(source, destination, { recursive: true })
    // Include real native executable bytes in the authorized target, not a display version.
    await cp(executable, join(source, 'Contents/MacOS/openforge-update-helper'))
    await writeFile(join(source, 'Contents/MacOS/openforge-sidecar'), 'target-sidecar')
    const staged = await store.stage(source)
    const authorizationRoot = join(root, 'authorization')
    const authorization = new UpdateAuthorizationStore({
      root: authorizationRoot, installationId: 'contract-installation', installedBundlePath: destination,
      bundles: store, confirmLocalBuild: async () => 'approve',
    })
    await authorization.authorizeLocal(staged, 'contract-operation')
    const helper = join(root, 'private-helper')
    await cp(executable, helper)
    let firstProbe = true
    const invoke = (action: string) => {
      const timeout = firstProbe ? 10_000 : 2_000
      firstProbe = false
      return spawnSync(helper, [], {
        input: JSON.stringify({ root: join(root, 'transaction'), destination, authorization: authorizationRoot,
          staging: resolve(staged.bundlePath, '..'), installation: 'contract-installation', operation: 'contract-operation', action }),
        encoding: 'utf8', env: {}, timeout,
      })
    }
    const prepared = invoke('prepare')
    expect(prepared.stderr).toBe('')
    expect(prepared.status).toBe(0)
    const replaced = invoke('replace')
    expect(replaced.stderr).toBe('')
    expect(replaced.status).toBe(0)
    expect(await readFile(join(destination, 'Contents/MacOS/openforge-sidecar'), 'utf8')).toBe('target-sidecar')
    expect(await readFile(join(destination, 'Contents/MacOS/openforge-update-helper'))).toEqual(await readFile(executable))
    const recovered = invoke('recover')
    expect(recovered.stderr).toBe('')
    expect(recovered.status).toBe(0)
    expect(await readFile(join(destination, 'Contents/MacOS/openforge-sidecar'), 'utf8')).toBe('sidecar')
    expect(invoke('replace').status).not.toBe(0)
  }, 30_000)
})
