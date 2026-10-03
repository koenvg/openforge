// @vitest-environment node
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateAuthorizationStore } from './updateAuthorization.js'
import { cleanupUpdateBundles, retainUpdateBundle, updateBundleFixture } from './updateBundle.testUtils.js'
import { openSync, closeSync } from 'node:fs'
import { FixtureProcess } from './fixtures/updateFixtureProcess.js'
import { commitNativeUpdate, verifyNativeUpdateLaunch } from './nativeUpdateHelper.js'

// Preparation runs during opt-in collection, outside timed runtime assertions.
// Both Cargo commands and the whole preparation process have separate hard deadlines.
const enabled = process.env.RUN_UPDATE_HELPER_CONTRACT === '1'
const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OPENFORGE_')))
const prepared = enabled ? JSON.parse(execFileSync(process.execPath, ['scripts/prepare-update-contract-fixtures.mjs'], {
  env: cleanEnvironment, encoding: 'utf8', timeout: 1_260_000, killSignal: 'SIGKILL',
}).trim()) : undefined
const executable: string = prepared?.artifacts['install-transaction-fixture']
const alternateExecutable: string = prepared?.artifacts['install-transaction-fixture-v2']
const sourceExecutable: string = prepared?.artifacts['source-sidecar-fixture']
const nativeExecutable: string = prepared?.artifacts['openforge-update-helper']
const daemonExecutable: string = prepared?.artifacts['openforge-session-daemon']
const targetDaemonExecutable: string = prepared?.artifacts['openforge-session-daemon-fixture-v2']
const pendingHelpers = new Set<() => Promise<void>>()
const ownedProcesses = new Set<FixtureProcess>()
const roots = new Set<string>()

function fixtureFilesystem(root: string, action: 'runtime' | 'copy' | 'remove', bundle: string, extra: Record<string, unknown> = {}) {
  const fd = openSync(join(root, 'filesystem.log'), 'a', 0o600)
  try {
    execFileSync(process.execPath, [prepared.filesystemWorker, JSON.stringify({ action, root, bundle, electronExecutable: prepared.electronExecutable, ...extra })], {
      env: cleanEnvironment, stdio: ['ignore', fd, fd], timeout: action === 'remove' ? 30_000 : 90_000, killSignal: 'SIGKILL',
    })
  } catch (error) {
    throw new Error(`Fixture ${action} failed; diagnostics retained at ${root}`, { cause: error })
  } finally { closeSync(fd) }
}
async function bundleFixture(ownedSource = false) {
  const fixture = await updateBundleFixture()
  roots.add(fixture.root)
  if (ownedSource) {
    await cp(sourceExecutable, join(fixture.source, 'Contents/MacOS/openforge-sidecar'))
    await cp(daemonExecutable, join(fixture.source, 'Contents/MacOS/openforge-session-daemon'))
    await cp(nativeExecutable, join(fixture.source, 'Contents/MacOS/openforge-update-helper'))
    fixtureFilesystem(fixture.root, 'runtime', fixture.source, { hostScript: prepared.sourceHost })
  }
  return fixture
}

function startSource(root: string, destination: string) {
  const host = new FixtureProcess(spawn(join(destination, 'Contents/MacOS/Open Forge'), [], {
    env: { ...cleanEnvironment, HOME: root, TMPDIR: root, OPENFORGE_ELECTRON_USER_DATA_DIR: root,
      OPENFORGE_APP_DATA_DIR: root, OPENFORGE_SESSION_DAEMON_ROOT: root }, stdio: ['pipe', 'pipe', 'pipe'],
  }), root, 'source-host')
  ownedProcesses.add(host)
  return host
}

async function sourceConfig(root: string, staged: import('./updateBundleStore.js').StagedUpdateBundle, extra: Record<string, unknown> = {}) {
  const target = { installationId: 'contract-installation', operationId: 'contract-operation', manifestSha256: staged.manifestSha256, images: staged.images }
  await writeFile(join(root, 'host.json'), JSON.stringify({ staging: resolve(staged.bundlePath, '..'), authorization: join(root, 'authorization'),
    destination: join(root, 'Installed.app'), recovery: join(root, 'transaction'), target, manifest: staged.manifest, ...extra,
  }), { mode: 0o600 })
  return target
}

async function expectSourceBytes(destination: string) {
  expect(await readFile(join(destination, 'Contents/MacOS/openforge-sidecar'))).toEqual(await readFile(sourceExecutable))
}

async function transactionRecord(root: string) {
  return JSON.parse(JSON.parse(await readFile(join(root, 'transaction/current.json'), 'utf8')).payload)
}

async function diagnose(root: string) {
  const progress = await readFile(join(root, 'target-entered'), 'utf8').catch(() => 'no JS entry')
  const record = await transactionRecord(root).catch(() => 'no journal')
  const log = await readFile(join(root, 'transaction/target-launch.log'), 'utf8').catch(() => '')
  console.error(`Native fixture diagnostics retained at ${root}`, JSON.stringify({ progress, record }), log.slice(-8000))
}

describe.skipIf(!enabled)('Electron authorization to native install/recovery contract', () => {
  afterEach(async ({ task }) => {
    let cleanupError: unknown
    try {
      // Release test-owned barriers before waiting for native transaction ownership.
      for (const root of roots) await writeFile(join(root, 'allow-relaunch-exit'), 'exit', { mode: 0o600 })
      await Promise.all([...ownedProcesses].map(child => child.stop()))
      for (const settle of pendingHelpers) await settle()
    } catch (error) { cleanupError = error }
    finally {
      ownedProcesses.clear()
      pendingHelpers.clear()
      const failed = task.result?.state === 'fail' || cleanupError
      for (const root of roots) {
        retainUpdateBundle(root)
        if (failed) await diagnose(root)
        else {
          try { fixtureFilesystem(root, 'remove', root) }
          catch (error) { cleanupError ??= error; await diagnose(root) }
        }
      }
      roots.clear()
      await cleanupUpdateBundles()
    }
    if (cleanupError) throw cleanupError
  }, 105_000)

  it.each(['current', 'daemon-aware-no-helper', 'legacy-approved', 'legacy-unapproved', 'legacy-changed'] as const)('authenticates complete replacement and pre-launch recovery: %s', async sourceKind => {
    const { root, source, store } = await bundleFixture()
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
        encoding: 'utf8', env: {}, timeout, killSignal: 'SIGKILL',
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

  it.each([true, false])('checks local code integrity before preparing a cancellable handoff: signed=%s', async signed => {
    const { root, source, store } = await bundleFixture(true)
    const destination = join(root, 'Installed.app')
    fixtureFilesystem(root, 'copy', destination, { source })
    if (!signed) await writeFile(join(source, 'Contents/MacOS/Open Forge'), 'unsigned local executable')
    const staged = await store.stage(source)
    const authorization = new UpdateAuthorizationStore({
      root: join(root, 'authorization'), installationId: 'contract-installation', installedBundlePath: destination,
      launch: { electronUserData: root, appData: root, daemonRoot: root }, bundles: store, confirmLocalBuild: async () => 'approve',
    })
    await authorization.authorizeLocal(staged, 'contract-operation')
    await sourceConfig(root, staged, { decision: 'cancel' })
    const host = startSource(root, destination)
    await host.waitForOutput('source-ready\n', 30_000)
    await host.waitForOutput(signed ? 'cancelled\n' : 'refused:Update helper did not acknowledge prepared\n', 60_000)
    await expectSourceBytes(destination)
    if (!signed) expect(host.errors).toContain('invalid authorized code signature')
    if (signed) {
      const record = await transactionRecord(root)
      expect(record.phase).toBe('rolled-back')
      expect(record.source.proof.birth.app.pid).toBe(host.child.pid)
      expect(record.source.proof.birth.sidecar.pid).toBeGreaterThan(1)
      expect(record.source.proof.birth.destination).toBe(destination)
    }
    host.child.stdin!.end('exit\n')
    await host.waitForExit(10_000)
    expect(host.child.exitCode).toBe(signed ? 0 : 1)
  }, 120_000)
  it.each(['admission', 'cold-image', 'cold-ready', 'cold-stall', 'wrong-cold-stall'])('replaces and launches after the real owning host exits: %s', async scenario => {
    const { root, source, store } = await bundleFixture(true)
    const destination = join(root, 'Installed.app')
    fixtureFilesystem(root, 'copy', destination, { source })
    await cp(nativeExecutable, join(source, 'Contents/MacOS/openforge-update-helper'))
    await cp(executable, join(source, 'Contents/MacOS/openforge-sidecar'))
    await cp(daemonExecutable, join(source, 'Contents/MacOS/openforge-session-daemon'))
    await cp(targetDaemonExecutable, join(root, 'unapproved-daemon'))
    const sidecarSubstitute = join(root, 'distinct-sidecar')
    await cp(alternateExecutable, sidecarSubstitute)
    const marker = join(root, 'launched')
    fixtureFilesystem(root, 'runtime', source, { hostScript: prepared.targetHost })
    const staged = await store.stage(source)
    const authorizationRoot = join(root, 'authorization')
    const authorization = new UpdateAuthorizationStore({
      root: authorizationRoot, installationId: 'contract-installation', installedBundlePath: destination,
      launch: { electronUserData: root, appData: root, daemonRoot: root },
      bundles: store, confirmLocalBuild: async () => 'approve',
    })
    await authorization.authorizeLocal(staged, 'contract-operation')
    const config = join(root, 'host.json')
    const target = { installationId: 'contract-installation', operationId: 'contract-operation', manifestSha256: staged.manifestSha256, images: staged.images }
    await writeFile(config, JSON.stringify({ staging: resolve(staged.bundlePath, '..'), authorization: authorizationRoot,
      destination, recovery: join(root, 'transaction'), target, marker, scenario, sidecarSubstitute, manifest: staged.manifest,
      ...(scenario === 'cold-ready' ? { ready: join(root, 'ready-to-commit'), resume: join(root, 'allow-commit') } : {}),
    }), { mode: 0o600 })
    const settleTarget = async (action: 'idle' | 'target-exited' = 'target-exited') => {
      await vi.waitFor(() => {
        const exited = spawnSync(executable, [], { env: {}, encoding: 'utf8', timeout: 5_000, killSignal: 'SIGKILL', input: JSON.stringify({
          root: join(root, 'transaction'), destination, authorization: authorizationRoot, staging: resolve(staged.bundlePath, '..'),
          installation: target.installationId, operation: target.operationId, action,
        }) })
        expect(exited.status, exited.stderr).toBe(0)
      }, { timeout: 60_000, interval: 50 })
      if (action === 'target-exited') pendingHelpers.delete(settleTarget)
    }
    const host = startSource(root, destination)
    try {
      await host.waitForOutput('armed\n', 60_000)
      await expectSourceBytes(destination)
      const armed = await transactionRecord(root)
      expect(armed.source.proof.birth.app.pid).toBe(host.child.pid)
      expect(armed.source.sidecarExitObserved).toBe(true)
      expect(armed.source.appExitObserved).toBe(false)
      pendingHelpers.add(settleTarget)
      host.child.stdin!.end('exit\n')
      await host.waitForExit(10_000)
      await settleTarget('idle') // Replacement has its own transaction budget; startup begins now.
      expect((await transactionRecord(root)).source.appExitObserved).toBe(true)
      if (scenario === 'cold-ready') {
        await vi.waitFor(async () => { expect(await readFile(join(root, 'ready-to-commit'), 'utf8')).not.toBe('') }, { timeout: 60_000, interval: 20 })
        const controller = JSON.parse(await readFile(join(root, 'ready-to-commit'), 'utf8'))
        await expect(commitNativeUpdate({ authorization, target, recoveryRoot: join(root, 'transaction'), controller })).rejects.toThrow('did not acknowledge committed')
        await writeFile(join(root, 'allow-commit'), '')
      }
      await vi.waitFor(async () => {
        expect(await readFile(marker, 'utf8')).not.toBe('')
      }, { timeout: 60_000, interval: 20 }) // Replacement and admission transaction.
      expect(await readFile(marker, 'utf8')).toBe(`--openforge-restart-operation=contract-operation\n${root}\n${root}\n${root}\nauthenticated\n`)
      await settleTarget()
      if (scenario.endsWith('-stall')) {
        const record = await transactionRecord(root)
        const log = await readFile(join(root, 'target-sidecar.log'), 'utf8')
        expect(log).toContain(`owned group=${record.sidecar.pid} retired`)
        const daemonPid = Number(log.match(/owned-daemon:(\d+)/)?.[1])
        expect(daemonPid).toBeGreaterThan(1)
        expect(() => process.kill(daemonPid, 0)).toThrowError(expect.objectContaining({ code: 'ESRCH' }))
        expect(() => process.kill(-record.sidecar.pid, 0)).toThrowError(expect.objectContaining({ code: 'ESRCH' }))
      }
      await expect(verifyNativeUpdateLaunch({ authorization, target, recoveryRoot: join(root, 'transaction') })).rejects.toThrow('did not acknowledge launch-verified')
      expect(await readFile(join(destination, 'Contents/MacOS/openforge-sidecar'))).toEqual(await readFile(executable))
      const commit = commitNativeUpdate({ authorization, target, recoveryRoot: join(root, 'transaction') })
      if (scenario === 'cold-ready') await commit
      else await expect(commit).rejects.toThrow('did not acknowledge committed')
    } catch (error) {
      await diagnose(root)
      throw error
    } finally {
      await host.stop()
    }
  }, 210_000)

  it('refuses a cold-install handoff when the authorized runtime root has a live owner', async () => {
    const { root, source, store } = await bundleFixture(true)
    const destination = join(root, 'Installed.app')
    fixtureFilesystem(root, 'copy', destination, { source })
    const staged = await store.stage(source)
    const authorization = new UpdateAuthorizationStore({
      root: join(root, 'authorization'), installationId: 'contract-installation', installedBundlePath: destination,
      launch: { electronUserData: root, appData: root, daemonRoot: root }, bundles: store, confirmLocalBuild: async () => 'approve',
    })
    await authorization.authorizeLocal(staged, 'contract-operation')
    const daemon = new FixtureProcess(spawn(daemonExecutable, [root], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] }), root, 'daemon')
    ownedProcesses.add(daemon)
    const observe = (controller?: unknown) => spawnSync(executable, [], { env: {}, encoding: 'utf8', timeout: 5_000, killSignal: 'SIGKILL', input: JSON.stringify({
      root, destination, authorization: join(root, 'authorization'), staging: resolve(staged.bundlePath, '..'),
      installation: 'contract-installation', operation: 'contract-operation', action: 'runtime-inventory', controller,
    }) })
    try {
      let controller: unknown
      await vi.waitFor(() => {
        const ready = observe()
        expect(ready.status, ready.stderr).toBe(0)
        controller = JSON.parse(ready.stdout).controller
      }, { timeout: 10_000, interval: 20 })
      await sourceConfig(root, staged)
      const host = startSource(root, destination)
      await host.waitForOutput('source-ready\n', 30_000)
      await host.waitForOutput('refused:Update helper did not acknowledge prepared\n', 60_000)
      await host.waitForExit(10_000)
      expect(host.child.exitCode).toBe(1)
      expect(observe(controller).status).toBe(0)
      await expectSourceBytes(destination)
    } finally { await daemon.stop() }
  }, 120_000)
  it.each(['cancel', 'install', 'lost-activation-ack', 'relaunch-pending', 'relaunch-committed', 'relaunch-cancel', 'relaunch-live-sidecar', 'relaunch-eof', 'wrong-daemon', 'missing-cli'])('preflights a live daemon without fencing Sidecar: %s', async mode => {
    const { root, source, store } = await bundleFixture(true)
    const destination = join(root, 'Installed.app')
    await cp(daemonExecutable, join(source, 'Contents/MacOS/openforge-session-daemon'))
    fixtureFilesystem(root, 'copy', destination, { source })
    await cp(nativeExecutable, join(source, 'Contents/MacOS/openforge-update-helper'))
    await cp(targetDaemonExecutable, join(source, 'Contents/MacOS/openforge-session-daemon'))
    const marker = join(root, 'target-started')
    await cp(executable, join(source, 'Contents/MacOS/Open Forge'))
    await cp(executable, join(source, 'Contents/MacOS/openforge-sidecar'))
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { packageRuntimeRelease } from './scripts/electron-package/runtime-release.mjs';
      const [daemonPath, cliAssetsPath, outputPath] = process.argv.slice(1);
      await packageRuntimeRelease({ daemonPath, cliAssetsPath, outputPath, architecture: process.arch === 'arm64' ? 'arm64' : 'x86_64' });
    `, mode === 'wrong-daemon' ? daemonExecutable : targetDaemonExecutable, mode === 'missing-cli' ? '' : join(source, 'Contents/Resources/openforge-cli'), join(source, 'Contents/Resources/session-runtime')], { env: cleanEnvironment, timeout: 30_000, killSignal: 'SIGKILL' })
    await cp(alternateExecutable, join(root, 'distinct-sidecar'))
    fixtureFilesystem(root, 'runtime', source, { hostScript: prepared.targetHost })
    const staged = await store.stage(source)
    const authorization = new UpdateAuthorizationStore({
      root: join(root, 'authorization'), installationId: 'contract-installation', installedBundlePath: destination,
      launch: { electronUserData: root, appData: root, daemonRoot: root }, bundles: store, confirmLocalBuild: async () => 'approve',
    })
    await authorization.authorizeLocal(staged, 'contract-operation')
    const daemon = new FixtureProcess(spawn(daemonExecutable, [root], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] }), root, 'daemon')
    ownedProcesses.add(daemon)
    const observe = (controller?: unknown, action: 'runtime-inventory' | 'runtime-observe' = 'runtime-inventory') => spawnSync(executable, [], { env: {}, encoding: 'utf8', timeout: 5_000, killSignal: 'SIGKILL', input: JSON.stringify({
      root, destination, authorization: join(root, 'authorization'), staging: resolve(staged.bundlePath, '..'),
      installation: 'contract-installation', operation: 'contract-operation', action, controller,
    }) })
    try {
      let controller: { installation: string; lifetime: string; generation: number } | undefined
      await vi.waitFor(() => {
        const ready = observe()
        expect(ready.status).toBe(0)
        controller = JSON.parse(ready.stdout).controller
      }, { timeout: 10_000, interval: 20 })
      const target = { installationId: 'contract-installation', operationId: 'contract-operation', manifestSha256: staged.manifestSha256, images: staged.images }
      await sourceConfig(root, staged, { controller, marker, scenario: mode, sidecarSubstitute: join(root, 'distinct-sidecar'), decision: mode === 'cancel' ? 'cancel' : 'arm' })
      if (mode === 'wrong-daemon' || mode === 'missing-cli' || mode === 'cancel') {
        const host = startSource(root, destination)
        await host.waitForOutput('source-ready\n', 30_000)
        await host.waitForOutput(mode === 'cancel' ? 'cancelled\n' : 'refused:Update helper did not acknowledge prepared\n', 60_000)
        expect(observe(controller).status).toBe(0)
        await expectSourceBytes(destination)
        await host.stop()
        return
      } else {
        const before = JSON.parse(observe(controller).stdout)
        const settleHelper = async (action: 'idle' | 'target-exited' = 'target-exited') => {
          // Bundle remeasurement is an install transaction, not a daemon probe.
          // Observe released kernel ownership before deleting this fixture root.
          await vi.waitFor(() => {
            const idle = spawnSync(executable, [], { env: {}, encoding: 'utf8', timeout: 5_000, killSignal: 'SIGKILL', input: JSON.stringify({
              root: join(root, 'transaction'), destination, authorization: join(root, 'authorization'), staging: resolve(staged.bundlePath, '..'),
              installation: target.installationId, operation: target.operationId, action: mode === 'lost-activation-ack' ? 'idle' : action,
            }) })
            expect(idle.status).toBe(0)
          }, { timeout: 60_000, interval: 50 })
          if (mode === 'lost-activation-ack') {
            const record = JSON.parse(JSON.parse(await readFile(join(root, 'transaction/current.json'), 'utf8')).payload)
            expect(['installed', 'rolled-back']).toContain(record.phase)
            expect(record.launched).toBeNull()
          }
          if (action === 'target-exited') pendingHelpers.delete(settleHelper)
        }
        pendingHelpers.add(settleHelper)
        const host = startSource(root, destination)
        try {
          await host.waitForOutput('armed\n', 60_000)
          expect(observe(controller).status).toBe(0)
          if (mode === 'lost-activation-ack') await writeFile(join(root, 'transaction/lose-runtime-activation-ack'), 'lose acknowledgement', { mode: 0o600 })
          await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
          host.child.stdin!.end('exit\n')
          await host.waitForExit(10_000)
          try {
            await settleHelper('idle')
            if (mode === 'lost-activation-ack') {
              const pending = JSON.parse(JSON.parse(await readFile(join(root, 'transaction/current.json'), 'utf8')).payload)
              expect(pending.phase).toBe('installed')
              expect(await readFile(join(destination, 'Contents/MacOS/openforge-sidecar'))).toEqual(await readFile(executable))
              const observation = observe(controller, 'runtime-observe')
              expect(observation.status, observation.stderr).toBe(0)
              const after = JSON.parse(observation.stdout)
              expect(after.status.state).toEqual({ kind: 'activated' })
              expect(after.status.fromVersion).toBe(before.capabilities.imageVersion)
              expect(after.status.actualVersion).toBe(after.capabilities.imageVersion)
              expect(after.capabilities.pid).toBe(before.capabilities.pid)
              expect(after.capabilities.imageVersion).not.toBe(before.capabilities.imageVersion)
              await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
              pendingHelpers.delete(settleHelper) // No target was launched; ownership was released above.
              return
            }
            if (mode === 'relaunch-committed' || mode === 'relaunch-pending') {
              await vi.waitFor(async () => {
                const progress = await Promise.allSettled([readFile(join(root, 'relaunch-armed')), readFile(marker)])
                expect(progress.some(result => result.status === 'fulfilled')).toBe(true)
              }, { timeout: 60_000, interval: 20 })
              await readFile(join(root, 'relaunch-armed'))
              const waiting = JSON.parse(JSON.parse(await readFile(join(root, 'transaction/current.json'), 'utf8')).payload)
              expect(waiting.launchAttempt).toBe(1)
              expect(waiting.launched.pid).toBe(Number(await readFile(join(root, 'previous-target-pid'), 'utf8')))
              const held = spawnSync(executable, [], { env: {}, encoding: 'utf8', timeout: 5_000, killSignal: 'SIGKILL', input: JSON.stringify({
                root: join(root, 'transaction'), destination, authorization: join(root, 'authorization'), staging: resolve(staged.bundlePath, '..'),
                installation: target.installationId, operation: target.operationId, action: 'idle',
              }) })
              expect(held.status).toBe(1)
              await writeFile(join(root, 'allow-relaunch-exit'), 'exit', { mode: 0o600 })
              await settleHelper('idle')
            }
            await vi.waitFor(async () => expect(await readFile(marker, 'utf8')).not.toBe(''), { timeout: 60_000, interval: 20 })
            expect(await readFile(marker, 'utf8')).toContain('\nauthenticated\n')
          } catch (error) {
            await diagnose(root)
            throw new Error('Target launch failed', { cause: error })
          }
          await settleHelper()
          const completed = JSON.parse(JSON.parse(await readFile(join(root, 'transaction/current.json'), 'utf8')).payload)
          expect(completed.phase).toBe('committed')
          expect(completed.launchAttempt).toBe(mode === 'relaunch-committed' || mode === 'relaunch-pending' ? 2 : 1)
          const after = JSON.parse(observe().stdout)
          expect(after.controller.lifetime).toBe(before.controller.lifetime)
          expect(after.capabilities.pid).toBe(before.capabilities.pid)
          expect(after.capabilities.imageVersion).not.toBe(before.capabilities.imageVersion)
          const commit = { authorization, target, recoveryRoot: join(root, 'transaction') }
          // The target already tested missing/stale/mutated controllers before committing.
          // Lost-acknowledgement retries recheck authority/bytes without reacquiring it.
          await commitNativeUpdate({ ...commit, controller: after.controller })
          await commitNativeUpdate({ ...commit, controller: after.controller })
        } finally {
          await host.stop()
          if (mode === 'relaunch-committed' || mode === 'relaunch-pending') await writeFile(join(root, 'allow-relaunch-exit'), 'exit', { mode: 0o600 })
          await settleHelper()
        }
      }
    } finally {
      await daemon.stop()
    }
  }, 210_000)
})
