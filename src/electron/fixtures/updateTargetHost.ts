// Isolated native-admission fixture. No domain backend or developer runtime access.
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { UpdateAuthorizationStore } from '../updateAuthorization.js'
import { UpdateBundleStore } from '../updateBundleStore.js'
import { measureUpdateBundle } from '../updateBundleManifest.js'
import { authorizeNativeUpdateSidecar, commitNativeUpdate, prepareNativeUpdateRelaunch, verifyNativeUpdateLaunch, verifyNativeUpdateReadiness, type NativeUpdateHandoff } from '../nativeUpdateHelper.js'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { strict as assert } from 'node:assert'
import { app } from 'electron'
import type { Writable } from 'node:stream'
import type { RestartTerminalController } from '../restartWorkspace.js'

const userData = process.env.OPENFORGE_ELECTRON_USER_DATA_DIR!
app.setPath('userData', userData)
app.setPath('sessionData', userData)
app.setActivationPolicy('prohibited')
app.commandLine.appendSwitch('disable-gpu')
const config = JSON.parse(await readFile(join(userData, 'host.json'), 'utf8'))
await writeFile(join(userData, 'target-entered'), 'entered')
const deadline = setTimeout(() => {
  void readFile(join(userData, 'target-entered'), 'utf8').then(progress => writeFile(config.marker, `refused: fixture transaction deadline at ${progress}`)).finally(() => app.exit(1))
}, 60_000)
deadline.unref()
try {
  const authorization = new UpdateAuthorizationStore({
    root: config.authorization, installationId: config.target.installationId,
    installedBundlePath: config.destination, bundles: new UpdateBundleStore(config.staging),
  })
  const retrying = config.scenario === 'relaunch-committed' || config.scenario === 'relaunch-pending'
  const previousTarget = retrying
    ? await readFile(join(userData, 'previous-target-pid'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return undefined
      throw error
    }) : undefined
  let relaunching = false
  if (config.scenario === 'admission') {
    const staged = await new UpdateBundleStore(join(userData, 'electron-staged')).stage(config.destination)
    assert.deepEqual(staged.images, config.target.images, 'Electron staging must preserve raw archive bytes')
  }
  await verifyNativeUpdateLaunch({ authorization, target: config.target, recoveryRoot: config.recovery })
  const update = { authorization, target: config.target, recoveryRoot: config.recovery }
  await assert.rejects(commitNativeUpdate(update), /did not acknowledge committed/, 'unadmitted processes must not commit')
  await writeFile(join(userData, 'target-entered'), 'staging verified')
  async function runSidecar(options: { replay?: string; mode?: 'clone-recovery' | 'running-image'; runtime?: 'cold' | 'live' | 'wrong-cold'; ready?: (controller: RestartTerminalController) => Promise<void> } = {}) {
    const path = join(config.destination, 'Contents/MacOS/openforge-sidecar')
    const saved = join(config.recovery, '..', 'authorized-sidecar')
    const substitute = join(config.recovery, '..', 'unapproved-sidecar')
    if (options.mode === 'running-image') {
      await cp(config.sidecarSubstitute, substitute)
      assert.notDeepEqual(await readFile(substitute), await readFile(path))
      await rename(path, saved)
      await rename(substitute, path)
    }
    const sidecar = spawn(path, ['--openforge-update-startup', ...(options.runtime ? [`--${options.runtime}-runtime`] : [])], {
      env: { ...process.env, OPENFORGE_RESTART_OPERATION: config.target.operationId }, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    })
    const sidecarExit = new Promise<number | null>(resolve => sidecar.once('exit', resolve))
    let output = ''
    let errors = ''
    let ready!: () => void
    const waiting = new Promise<void>(resolve => { ready = resolve })
    let runtimeReady!: (controller: RestartTerminalController) => void
    const runtimeWaiting = new Promise<RestartTerminalController>(resolve => { runtimeReady = resolve })
    const prefix = 'sidecar-awaiting-admission\n'
    sidecar.stdout.on('data', chunk => {
      output += String(chunk)
      if (output.startsWith(prefix)) ready()
      const runtime = output.match(/runtime-ready:(\{[^\n]+\})\n/)
      if (runtime) runtimeReady(JSON.parse(runtime[1]))
    })
    sidecar.stderr.on('data', chunk => { errors += String(chunk) })
    try {
      let timer: NodeJS.Timeout | undefined
      try {
        await Promise.race([waiting, sidecarExit.then(() => { throw new Error('Sidecar exited before its admission wait') }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Sidecar admission wait probe timed out')), 10_000) })])
      } finally { clearTimeout(timer) }
      if (options.mode === 'running-image') {
        // Restore authorized on-disk bytes while the other image waits on stdin.
        await rename(path, substitute)
        await rename(saved, path)
      }
      let admission = options.replay ?? await authorizeNativeUpdateSidecar({ ...update, sidecarPid: sidecar.pid! })
      if (options.mode === 'clone-recovery') {
        const root = join(config.recovery, '..', 'cloned-recovery')
        await mkdir(root, { mode: 0o700 })
        for (const file of ['journal.key', 'current.json']) await cp(join(config.recovery, file), join(root, file))
        admission = JSON.stringify({ ...JSON.parse(admission), root })
      }
      sidecar.stdin.end(admission)
      if (options.ready) {
        let timer: NodeJS.Timeout | undefined
        try {
          const controller = await Promise.race([runtimeWaiting, sidecarExit.then(() => { throw new Error(`Runtime fixture exited: ${errors}`) }),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Runtime readiness probe timed out')), 10_000) })])
          clearTimeout(timer)
          await options.ready(controller)
        } finally {
          clearTimeout(timer)
          ;(sidecar.stdio[3] as Writable).end()
        }
      }
      await writeFile(join(userData, 'target-entered'), `waiting for Sidecar exit: ${options.runtime ?? options.mode ?? 'admission'}`)
      const code = await sidecarExit
      return { code, output: output.slice(prefix.length), errors, admission }
    } catch (error) {
      throw new Error(`${String(error)}; owned Sidecar code=${sidecar.exitCode} signal=${sidecar.signalCode}: ${errors}`)
    } finally {
      ;(sidecar.stdio[3] as Writable).end()
      // Runtime fixtures observe EOF and reap their owned cold daemon before exiting.
      if (options.runtime) await sidecarExit
      else { sidecar.kill('SIGKILL'); await sidecarExit }
    }
  }
  if (config.scenario === 'admission') {
    await assert.rejects(authorizeNativeUpdateSidecar({ ...update, sidecarPid: process.pid }))
    await writeFile(join(userData, 'target-entered'), 'checking substituted image')
    const wrongImage = await runSidecar({ mode: 'running-image' })
    assert.notEqual(wrongImage.code, 0, 'unapproved running Sidecar image was admitted')
    assert.match(wrongImage.errors, /running update image does not match the authorized executable/)
    assert.equal(wrongImage.output, '')
    await writeFile(join(userData, 'target-entered'), 'checking cloned recovery')
    const cloned = await runSidecar({ mode: 'clone-recovery' })
    assert.notEqual(cloned.code, 0)
    assert.match(cloned.errors, /another recovery root/)
    const valid = await runSidecar()
    assert.equal(valid.code, 0, valid.errors)
    assert.equal(valid.output.trim(), 'sidecar-authorized')
    const replay = await runSidecar({ replay: valid.admission })
    assert.notEqual(replay.code, 0)
    assert.match(replay.errors, /not the authenticated launched process/)
  } else if (config.scenario === 'cold-image') {
    const wrongRuntime = await runSidecar({ runtime: 'wrong-cold', ready: async controller => {
      await writeFile(join(userData, 'target-entered'), 'checking wrong daemon readiness')
      await assert.rejects(verifyNativeUpdateReadiness({ ...update, controller }))
      await writeFile(join(userData, 'target-entered'), 'checking wrong daemon commit')
      await assert.rejects(commitNativeUpdate({ ...update, controller }))
    } })
    assert.equal(wrongRuntime.code, 0, wrongRuntime.errors)
  } else if (config.scenario === 'relaunch-eof') {
    const ready = await runSidecar({ runtime: 'live', ready: async controller => {
      await commitNativeUpdate({ ...update, controller })
      // Exit below without authorizing relaunch: inherited-stream EOF only releases ownership.
      await prepareNativeUpdateRelaunch(update)
    } })
    assert.equal(ready.code, 0, ready.errors)
  } else if (config.scenario === 'relaunch-cancel' || config.scenario === 'relaunch-live-sidecar') {
    const ready = await runSidecar({ runtime: 'live', ready: async controller => {
      const handoff = await prepareNativeUpdateRelaunch(update)
      if (config.scenario === 'relaunch-cancel') await handoff.cancel()
      else await assert.rejects(handoff.arm(), /did not acknowledge armed/)
      // Neither cancellation nor refusal may commit, roll back or consume startup authority.
      await assert.rejects(commitNativeUpdate(update))
      await commitNativeUpdate({ ...update, controller })
    } })
    assert.equal(ready.code, 0, ready.errors)
  } else if (retrying && !previousTarget) {
    let handoff: NativeUpdateHandoff | undefined
    const ready = await runSidecar({ runtime: 'live', ready: async controller => {
      await verifyNativeUpdateReadiness({ ...update, controller })
      if (config.scenario === 'relaunch-committed') await commitNativeUpdate({ ...update, controller })
      await writeFile(join(userData, 'previous-target-pid'), String(process.pid), { mode: 0o600 })
      handoff = await prepareNativeUpdateRelaunch(update)
    } })
    assert.equal(ready.code, 0, ready.errors)
    assert.ok(handoff)
    await writeFile(join(userData, 'target-entered'), 'arming authenticated relaunch')
    await handoff.arm()
    relaunching = true
    await writeFile(join(userData, 'relaunch-armed'), 'armed', { mode: 0o600 })
    while (!await readFile(join(userData, 'allow-relaunch-exit')).then(() => true, error => {
      if (error.code !== 'ENOENT') throw error
      return false
    })) await new Promise(resolve => setTimeout(resolve, 20))
  } else {
    if (previousTarget) assert.notEqual(process.pid, Number(previousTarget), 'recovery must use a new native-authorized process')
    await writeFile(join(userData, 'target-entered'), 'checking runtime readiness')
    const ready = await runSidecar({ runtime: config.controller ? 'live' : 'cold', ready: async controller => {
      await verifyNativeUpdateReadiness({ ...update, controller })
      await assert.rejects(commitNativeUpdate(update))
      const stale = { ...(config.controller ?? controller), generation: config.controller?.generation ?? 0 }
      const attempt = commitNativeUpdate({ ...update, controller: stale })
      Object.assign(stale, controller)
      await assert.rejects(attempt)
      if (config.ready) {
        await writeFile(config.ready, JSON.stringify(controller))
        const until = Date.now() + 5_000
        for (;;) {
          try { await readFile(config.resume); break } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || Date.now() >= until) throw error
            await new Promise(resolve => setTimeout(resolve, 20))
          }
        }
      }
      await commitNativeUpdate({ ...update, controller })
      await commitNativeUpdate({ ...update, controller })
    } })
    assert.equal(ready.code, 0, ready.errors)
  }
  if (!relaunching) await writeFile(config.marker, [process.argv.find(arg => arg.startsWith('--openforge-restart-operation=')), process.env.OPENFORGE_ELECTRON_USER_DATA_DIR,
    process.env.OPENFORGE_APP_DATA_DIR, process.env.OPENFORGE_SESSION_DAEMON_ROOT, 'authenticated', ''].join('\n'))
} catch (error) {
  const expected = config.manifest.entries as Awaited<ReturnType<typeof measureUpdateBundle>>['entries']
  const actual = (await measureUpdateBundle(config.destination)).entries
  const changed = actual.filter(entry => JSON.stringify(entry) !== JSON.stringify(expected.find(item => item.path === entry.path)))
  await writeFile(config.marker, `refused: ${error instanceof Error ? error.stack : String(error)}\nchanged: ${JSON.stringify(changed)}`)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  app.exit(Number(process.exitCode ?? 0))
}
