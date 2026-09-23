// @vitest-environment node
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { build } from 'vite'
import { UpdateAuthorizationStore } from './updateAuthorization.js'
import { cleanupUpdateBundles, updateBundleFixture } from './updateBundle.testUtils.js'

import { commitNativeUpdate, prepareNativeUpdateHandoff, verifyNativeUpdateLaunch } from './nativeUpdateHelper.js'
// Opt-in builds private native executables. It never invokes an installed helper or desktop app.
const enabled = process.env.RUN_UPDATE_HELPER_CONTRACT === '1'
const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OPENFORGE_')))
let executable: string
let nativeExecutable: string
let daemonExecutable: string
let targetDaemonExecutable: string
const pendingHelpers = new Set<() => Promise<void>>()

describe.skipIf(!enabled)('Electron authorization to native install/recovery contract', () => {
  beforeAll(() => {
    const manifest = execFileSync(process.execPath, ['scripts/rust-sidecar-layout.mjs', 'update-helper-manifest-path'], { encoding: 'utf8', env: cleanEnvironment }).trim()
    const build = execFileSync('cargo', ['build', '--manifest-path', manifest, '--features', 'test-fixtures', '--example', 'install-transaction-fixture', '--bins', '--message-format=json'], { encoding: 'utf8', env: cleanEnvironment, maxBuffer: 8 * 1024 ** 2 })
    const outputs = build.split('\n').filter(Boolean).map(line => JSON.parse(line))
    executable = outputs.find(row => row.reason === 'compiler-artifact' && row.target.name === 'install-transaction-fixture' && row.executable)?.executable
    if (!executable) throw new Error('Native updater fixture was not built')
    nativeExecutable = outputs.find(row => row.reason === 'compiler-artifact' && row.target.name === 'openforge-update-helper' && row.target.kind.includes('bin') && row.executable)?.executable
    if (!nativeExecutable) throw new Error('Native updater was not built')
    const daemonManifest = execFileSync(process.execPath, ['scripts/rust-sidecar-layout.mjs', 'session-daemon-manifest-path'], { encoding: 'utf8', env: cleanEnvironment }).trim()
    const daemonBuild = execFileSync('cargo', ['build', '--manifest-path', daemonManifest, '--features', 'replacement-fixtures', '--bins', '--message-format=json'], { encoding: 'utf8', env: cleanEnvironment, maxBuffer: 8 * 1024 ** 2 })
    daemonExecutable = daemonBuild.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(row => row.reason === 'compiler-artifact' && row.target.name === 'openforge-session-daemon' && row.executable)?.executable
    targetDaemonExecutable = daemonBuild.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(row => row.reason === 'compiler-artifact' && row.target.name === 'openforge-session-daemon-fixture-v2' && row.executable)?.executable
    if (!targetDaemonExecutable) throw new Error('Distinct daemon fixture was not built')
    if (!daemonExecutable) throw new Error('Native daemon fixture was not built')
  }, 120_000)

  afterEach(async () => {
    for (const settle of pendingHelpers) await settle()
    await cleanupUpdateBundles()
  }, 65_000)

  it.each(['current', 'daemon-aware-no-helper', 'legacy-approved', 'legacy-unapproved', 'legacy-changed'] as const)('authenticates complete replacement and pre-launch recovery: %s', async sourceKind => {
    const { root, source, store } = await updateBundleFixture()
    const destination = join(root, 'Installed.app')
    await cp(source, destination, { recursive: true })
    if (sourceKind !== 'current') {
      await rm(join(destination, 'Contents/MacOS/openforge-update-helper'))
      if (sourceKind.startsWith('legacy')) await rm(join(destination, 'Contents/MacOS/openforge-session-daemon'))
    }
    // Include real native executable bytes in the authorized target, not a display version.
    await cp(executable, join(source, 'Contents/MacOS/openforge-update-helper'))
    await writeFile(join(source, 'Contents/MacOS/openforge-sidecar'), 'target-sidecar')
    const staged = await store.stage(source)
    const authorizationRoot = join(root, 'authorization')
    const authorization = new UpdateAuthorizationStore({
      root: authorizationRoot, installationId: 'contract-installation', installedBundlePath: destination,
      bundles: store, confirmLocalBuild: async () => 'approve',
      confirmFirstAdoption: async () => 'approve',
    })
    await authorization.authorizeLocal(staged, 'contract-operation', ['legacy-approved', 'legacy-changed'].includes(sourceKind) ? { firstAdoption: true } : {})
    if (sourceKind === 'legacy-changed') await writeFile(join(destination, 'Contents/MacOS/openforge-sidecar'), 'changed-after-consent')
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
    if (sourceKind === 'legacy-unapproved') {
      expect(prepared.status).not.toBe(0)
      expect(prepared.stderr).toContain('missing usable')
      expect(await readFile(join(destination, 'Contents/MacOS/openforge-sidecar'), 'utf8')).toBe('sidecar')
      return
    }
    if (sourceKind === 'legacy-changed') {
      expect(prepared.status).not.toBe(0)
      expect(prepared.stderr).toContain('first-adoption installed bundle changed')
      return
    }
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
    if (sourceKind !== 'current') {
      await expect(readFile(join(destination, 'Contents/MacOS/openforge-update-helper'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    expect(invoke('replace').status).not.toBe(0)
  }, 30_000)

  it('prepares and cancels through the real authenticated helper without replacing the app', async () => {
    const { root, source, store } = await updateBundleFixture()
    const destination = join(root, 'Installed.app')
    await cp(source, destination, { recursive: true })
    await cp(nativeExecutable, join(source, 'Contents/MacOS/openforge-update-helper'))
    const staged = await store.stage(source)
    const authorization = new UpdateAuthorizationStore({
      root: join(root, 'authorization'), installationId: 'contract-installation', installedBundlePath: destination,
      launch: { electronUserData: root, appData: root, daemonRoot: root },
      bundles: store, confirmLocalBuild: async () => 'approve',
    })
    await authorization.authorizeLocal(staged, 'contract-operation')
    const handoff = await prepareNativeUpdateHandoff({
      authorization, bundles: store, recoveryRoot: join(root, 'transaction'),
      target: { installationId: 'contract-installation', operationId: 'contract-operation', manifestSha256: staged.manifestSha256, images: staged.images },
    })
    await handoff.cancel()
    expect(await readFile(join(destination, 'Contents/MacOS/openforge-sidecar'), 'utf8')).toBe('sidecar')
    await expect(handoff.arm()).rejects.toThrow('already decided')
  }, 20_000)

  it('replaces and launches the authorized target only after the real owning host exits', async () => {
    const { root, source, store } = await updateBundleFixture()
    const destination = join(root, 'Installed.app')
    await cp(source, destination, { recursive: true })
    await cp(nativeExecutable, join(source, 'Contents/MacOS/openforge-update-helper'))
    await cp(executable, join(source, 'Contents/MacOS/openforge-sidecar'))
    const marker = join(root, 'launched')
    const targetModule = 'Contents/Resources/app/dist-electron/target.mjs'
    await build({ configFile: false, publicDir: false, logLevel: 'silent', build: {
      ssr: 'src/electron/fixtures/updateTargetHost.ts', outDir: join(source, 'Contents/Resources/app/dist-electron'), emptyOutDir: false,
      rollupOptions: { external: ['electron'], output: { entryFileNames: 'target.mjs' } },
    } })
    const quote = (path: string) => `'${path.replaceAll("'", "'\\''")}'`
    await writeFile(join(source, 'Contents/MacOS/Open Forge'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(destination, targetModule))} ${quote(join(root, 'host.json'))} "$@"\n`)
    const staged = await store.stage(source)
    const authorizationRoot = join(root, 'authorization')
    const authorization = new UpdateAuthorizationStore({
      root: authorizationRoot, installationId: 'contract-installation', installedBundlePath: destination,
      launch: { electronUserData: root, appData: root, daemonRoot: root },
      bundles: store, confirmLocalBuild: async () => 'approve',
    })
    await authorization.authorizeLocal(staged, 'contract-operation')
    const hostScript = join(root, 'host.mjs')
    await build({ configFile: false, publicDir: false, logLevel: 'silent', build: {
      ssr: 'src/electron/fixtures/updateHelperHost.ts', outDir: root, emptyOutDir: false,
      rollupOptions: { external: ['electron'], output: { entryFileNames: 'host.mjs' } },
    } })
    const config = join(root, 'host.json')
    const target = { installationId: 'contract-installation', operationId: 'contract-operation', manifestSha256: staged.manifestSha256, images: staged.images }
    await writeFile(config, JSON.stringify({ staging: resolve(staged.bundlePath, '..'), authorization: authorizationRoot,
      destination, recovery: join(root, 'transaction'), target, marker }), { mode: 0o600 })
    const settleTarget = async () => {
      await vi.waitFor(() => {
        const exited = spawnSync(executable, [], { env: {}, encoding: 'utf8', timeout: 5_000, input: JSON.stringify({
          root: join(root, 'transaction'), destination, authorization: authorizationRoot, staging: resolve(staged.bundlePath, '..'),
          installation: target.installationId, operation: target.operationId, action: 'target-exited',
        }) })
        expect(exited.status, exited.stderr).toBe(0)
      }, { timeout: 60_000, interval: 50 })
      pendingHelpers.delete(settleTarget)
    }
    const host = spawn(process.execPath, [hostScript, config], { env: { ...cleanEnvironment, HOME: root, TMPDIR: root }, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    let errors = ''
    host.stdout.on('data', chunk => { output += chunk.toString() })
    host.stderr.on('data', chunk => { errors += chunk.toString() })
    const exited = new Promise<void>(resolve => host.once('exit', () => resolve()))
    try {
      await vi.waitFor(() => {
        expect(errors).toBe('')
        expect(output).toContain('armed\n')
      }, { timeout: 10_000, interval: 20 })
      expect(await readFile(join(destination, 'Contents/MacOS/openforge-sidecar'), 'utf8')).toBe('sidecar')
      pendingHelpers.add(settleTarget)
      host.stdin.end('exit\n')
      await exited
      await vi.waitFor(async () => {
        expect(await readFile(marker, 'utf8')).toBe(`--openforge-restart-operation=contract-operation\n${root}\n${root}\n${root}\nauthenticated\n`)
      }, { timeout: 10_000, interval: 20 })
      await settleTarget()
      await expect(verifyNativeUpdateLaunch({ authorization, target, recoveryRoot: join(root, 'transaction') })).rejects.toThrow('did not acknowledge launch-verified')
      expect(await readFile(join(destination, 'Contents/MacOS/openforge-sidecar'))).toEqual(await readFile(executable))
      await commitNativeUpdate({ authorization, target: { installationId: 'contract-installation', operationId: 'contract-operation', manifestSha256: staged.manifestSha256, images: staged.images }, recoveryRoot: join(root, 'transaction') })
    } finally {
      host.kill('SIGKILL')
      await exited
    }
  }, 40_000)

  it('refuses a cold-install handoff when the authorized runtime root has a live owner', async () => {
    const { root, source, store } = await updateBundleFixture()
    const destination = join(root, 'Installed.app')
    await cp(source, destination, { recursive: true })
    await cp(nativeExecutable, join(source, 'Contents/MacOS/openforge-update-helper'))
    const staged = await store.stage(source)
    const authorization = new UpdateAuthorizationStore({
      root: join(root, 'authorization'), installationId: 'contract-installation', installedBundlePath: destination,
      launch: { electronUserData: root, appData: root, daemonRoot: root }, bundles: store, confirmLocalBuild: async () => 'approve',
    })
    await authorization.authorizeLocal(staged, 'contract-operation')
    const daemon = spawn(daemonExecutable, [root], { env: {}, stdio: 'ignore' })
    const exited = new Promise<void>(resolve => daemon.once('exit', () => resolve()))
    const observe = (controller?: unknown) => spawnSync(executable, [], { env: {}, encoding: 'utf8', timeout: 5_000, input: JSON.stringify({
      root, destination, authorization: join(root, 'authorization'), staging: resolve(staged.bundlePath, '..'),
      installation: 'contract-installation', operation: 'contract-operation', action: 'runtime-inventory', controller,
    }) })
    try {
      let controller: unknown
      await vi.waitFor(() => {
        const ready = observe()
        expect(ready.status).toBe(0)
        controller = JSON.parse(ready.stdout).controller
      }, { timeout: 10_000, interval: 20 })
      let handoff: Awaited<ReturnType<typeof prepareNativeUpdateHandoff>> | undefined
      let refusal: unknown
      try {
        handoff = await prepareNativeUpdateHandoff({
          authorization, bundles: store, recoveryRoot: join(root, 'transaction'),
          target: { installationId: 'contract-installation', operationId: 'contract-operation', manifestSha256: staged.manifestSha256, images: staged.images },
        })
      } catch (error) { refusal = error }
      finally { await handoff?.cancel() }
      expect(refusal).toBeInstanceOf(Error)
      expect(observe(controller).status).toBe(0)
    } finally {
      daemon.kill('SIGTERM')
      await exited
    }
  }, 30_000)

  it.each(['cancel', 'install', 'wrong-daemon', 'missing-cli'])('preflights a live daemon without fencing Sidecar: %s', async mode => {
    const { root, source, store } = await updateBundleFixture()
    const destination = join(root, 'Installed.app')
    await cp(source, destination, { recursive: true })
    await cp(nativeExecutable, join(source, 'Contents/MacOS/openforge-update-helper'))
    await cp(targetDaemonExecutable, join(source, 'Contents/MacOS/openforge-session-daemon'))
    const marker = join(root, 'target-started')
    await writeFile(join(source, 'Contents/MacOS/Open Forge'), `#!/bin/sh\nprintf updated > ${JSON.stringify(marker)}\n`, { mode: 0o755 })
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { packageRuntimeRelease } from './scripts/electron-package/runtime-release.mjs';
      const [daemonPath, cliAssetsPath, outputPath] = process.argv.slice(1);
      await packageRuntimeRelease({ daemonPath, cliAssetsPath, outputPath, architecture: process.arch === 'arm64' ? 'arm64' : 'x86_64' });
    `, mode === 'wrong-daemon' ? daemonExecutable : targetDaemonExecutable, mode === 'missing-cli' ? '' : join(source, 'Contents/Resources/openforge-cli'), join(source, 'Contents/MacOS/session-runtime')], { env: cleanEnvironment })
    const staged = await store.stage(source)
    const authorization = new UpdateAuthorizationStore({
      root: join(root, 'authorization'), installationId: 'contract-installation', installedBundlePath: destination,
      launch: { electronUserData: root, appData: root, daemonRoot: root }, bundles: store, confirmLocalBuild: async () => 'approve',
    })
    await authorization.authorizeLocal(staged, 'contract-operation')
    const daemon = spawn(daemonExecutable, [root], { env: {}, stdio: 'ignore' })
    const exited = new Promise<void>(resolve => daemon.once('exit', () => resolve()))
    const observe = (controller?: unknown) => spawnSync(executable, [], { env: {}, encoding: 'utf8', timeout: 5_000, input: JSON.stringify({
      root, destination, authorization: join(root, 'authorization'), staging: resolve(staged.bundlePath, '..'),
      installation: 'contract-installation', operation: 'contract-operation', action: 'runtime-inventory', controller,
    }) })
    try {
      let controller: { installation: string; lifetime: string; generation: number } | undefined
      await vi.waitFor(() => {
        const ready = observe()
        expect(ready.status).toBe(0)
        controller = JSON.parse(ready.stdout).controller
      }, { timeout: 10_000, interval: 20 })
      const target = { installationId: 'contract-installation', operationId: 'contract-operation', manifestSha256: staged.manifestSha256, images: staged.images }
      if (mode === 'wrong-daemon' || mode === 'missing-cli') {
        await expect(prepareNativeUpdateHandoff({ authorization, bundles: store, recoveryRoot: join(root, 'transaction'), controller, target })).rejects.toThrow('did not acknowledge prepared')
        expect(observe(controller).status).toBe(0)
        expect(await readFile(join(destination, 'Contents/MacOS/openforge-sidecar'), 'utf8')).toBe('sidecar')
        return
      }
      if (mode === 'cancel') {
        const handoff = await prepareNativeUpdateHandoff({ authorization, bundles: store, recoveryRoot: join(root, 'transaction'), controller, target })
        try { expect(observe(controller).status).toBe(0) }
        finally { await handoff.cancel() }
        expect(observe(controller).status).toBe(0)
      } else {
        const before = JSON.parse(observe(controller).stdout)
        const hostScript = join(root, 'host.mjs')
        await build({ configFile: false, publicDir: false, logLevel: 'silent', build: {
          ssr: 'src/electron/fixtures/updateHelperHost.ts', outDir: root, emptyOutDir: false,
          rollupOptions: { external: ['electron'], output: { entryFileNames: 'host.mjs' } },
        } })
        const config = join(root, 'host.json')
        await writeFile(config, JSON.stringify({ staging: resolve(staged.bundlePath, '..'), authorization: join(root, 'authorization'), destination, recovery: join(root, 'transaction'), target, controller }), { mode: 0o600 })
        const settleHelper = async () => {
          // Bundle remeasurement is an install transaction, not a daemon probe.
          // Observe released kernel ownership before deleting this fixture root.
          await vi.waitFor(() => {
            const idle = spawnSync(executable, [], { env: {}, encoding: 'utf8', timeout: 5_000, input: JSON.stringify({
              root: join(root, 'transaction'), destination, authorization: join(root, 'authorization'), staging: resolve(staged.bundlePath, '..'),
              installation: target.installationId, operation: target.operationId, action: 'idle',
            }) })
            expect(idle.status).toBe(0)
          }, { timeout: 60_000, interval: 50 })
          pendingHelpers.delete(settleHelper)
        }
        pendingHelpers.add(settleHelper)
        const host = spawn(process.execPath, [hostScript, config], { env: { ...cleanEnvironment, HOME: root, TMPDIR: root }, stdio: ['pipe', 'pipe', 'pipe'] })
        const hostExit = new Promise<void>(resolve => host.once('exit', () => resolve()))
        let output = ''
        host.stdout.on('data', chunk => { output += String(chunk) })
        host.stderr.resume()
        try {
          await vi.waitFor(() => expect(output).toContain('armed'), { timeout: 15_000, interval: 20 })
          expect(observe(controller).status).toBe(0)
          await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
          host.stdin.end('exit\n')
          await hostExit
          try {
            await settleHelper()
            await vi.waitFor(async () => expect(await readFile(marker, 'utf8')).toBe('updated'), { timeout: 10_000, interval: 20 })
          } catch (error) {
            const record = JSON.parse(JSON.parse(await readFile(join(root, 'transaction/current.json'), 'utf8')).payload)
            throw new Error(`Target launch failed; native phase=${record.phase}`, { cause: error })
          }
          const after = JSON.parse(observe().stdout)
          expect(after.controller.lifetime).toBe(before.controller.lifetime)
          expect(after.capabilities.pid).toBe(before.capabilities.pid)
          expect(after.capabilities.imageVersion).not.toBe(before.capabilities.imageVersion)
          const commit = { authorization, target, recoveryRoot: join(root, 'transaction') }
          await expect(commitNativeUpdate(commit)).rejects.toThrow('did not acknowledge committed')
          const borrowedController = { ...before.controller }
          const staleCommit = commitNativeUpdate({ ...commit, controller: borrowedController })
          Object.assign(borrowedController, after.controller)
          await expect(staleCommit).rejects.toThrow('did not acknowledge committed')
          await expect(commitNativeUpdate({ ...commit, controller: before.controller })).rejects.toThrow('did not acknowledge committed')
          await commitNativeUpdate({ ...commit, controller: after.controller })
          await commitNativeUpdate({ ...commit, controller: after.controller })
        } finally { host.kill('SIGKILL'); await hostExit; await settleHelper() }
      }
    } finally {
      daemon.kill('SIGTERM')
      await exited
    }
  }, 150_000)
})
