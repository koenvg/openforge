// Isolated native-admission fixture. No domain backend or developer runtime access.
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { UpdateAuthorizationStore } from '../updateAuthorization.js'
import { UpdateBundleStore } from '../updateBundleStore.js'
import { authorizeNativeUpdateSidecar, verifyNativeUpdateLaunch } from '../nativeUpdateHelper.js'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { strict as assert } from 'node:assert'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const deadline = setTimeout(() => process.exit(1), 20_000)
deadline.unref()
try {
  const authorization = new UpdateAuthorizationStore({
    root: config.authorization, installationId: config.target.installationId,
    installedBundlePath: config.destination, bundles: new UpdateBundleStore(config.staging),
  })
  await verifyNativeUpdateLaunch({ authorization, target: config.target, recoveryRoot: config.recovery })
  const update = { authorization, target: config.target, recoveryRoot: config.recovery }
  await assert.rejects(authorizeNativeUpdateSidecar({ ...update, sidecarPid: process.pid }))
  async function runSidecar(options: { replay?: string; mode?: 'clone-recovery' | 'running-image' } = {}) {
    const path = join(config.destination, 'Contents/MacOS/openforge-sidecar')
    const saved = join(config.recovery, '..', 'authorized-sidecar')
    const substitute = join(config.recovery, '..', 'unapproved-sidecar')
    if (options.mode === 'running-image') {
      await cp(config.sidecarSubstitute, substitute)
      assert.notDeepEqual(await readFile(substitute), await readFile(path))
      await rename(path, saved)
      await rename(substitute, path)
    }
    const sidecar = spawn(path, ['--openforge-update-startup'], {
      env: { ...process.env, OPENFORGE_RESTART_OPERATION: config.target.operationId }, stdio: ['pipe', 'pipe', 'pipe'],
    })
    const sidecarExit = new Promise<number | null>(resolve => sidecar.once('exit', resolve))
    let output = ''
    let errors = ''
    let ready!: () => void
    const waiting = new Promise<void>(resolve => { ready = resolve })
    const prefix = 'sidecar-awaiting-admission\n'
    sidecar.stdout.on('data', chunk => {
      output += String(chunk)
      if (output.startsWith(prefix)) ready()
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
      const code = await sidecarExit
      return { code, output: output.slice(prefix.length), errors, admission }
    } catch (error) {
      throw new Error(`${String(error)}; owned Sidecar code=${sidecar.exitCode} signal=${sidecar.signalCode}: ${errors}`)
    } finally { sidecar.kill('SIGKILL'); await sidecarExit }
  }
  const wrongImage = await runSidecar({ mode: 'running-image' })
  assert.notEqual(wrongImage.code, 0, 'unapproved running Sidecar image was admitted')
  assert.match(wrongImage.errors, /running update image does not match the authorized executable/)
  assert.equal(wrongImage.output, '')
  const cloned = await runSidecar({ mode: 'clone-recovery' })
  assert.notEqual(cloned.code, 0)
  assert.match(cloned.errors, /another recovery root/)
  const valid = await runSidecar()
  assert.equal(valid.code, 0, valid.errors)
  assert.equal(valid.output.trim(), 'sidecar-authorized')
  const replay = await runSidecar({ replay: valid.admission })
  assert.notEqual(replay.code, 0)
  assert.match(replay.errors, /not the authenticated launched process/)
  await writeFile(config.marker, [process.argv[3], process.env.OPENFORGE_ELECTRON_USER_DATA_DIR,
    process.env.OPENFORGE_APP_DATA_DIR, process.env.OPENFORGE_SESSION_DAEMON_ROOT, 'authenticated', ''].join('\n'))
} catch (error) {
  await writeFile(config.marker, `refused: ${String(error)}`)
  process.exitCode = 1
} finally { clearTimeout(deadline) }
