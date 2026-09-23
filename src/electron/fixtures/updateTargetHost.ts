// Isolated native-admission fixture. No domain backend or developer runtime access.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
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
  async function runSidecar(replay?: string, cloneRecovery = false) {
    const sidecar = spawn(join(config.destination, 'Contents/MacOS/openforge-sidecar'), ['--openforge-update-startup'], {
      env: { ...process.env, OPENFORGE_RESTART_OPERATION: config.target.operationId }, stdio: ['pipe', 'pipe', 'pipe'],
    })
    const sidecarExit = new Promise<number | null>(resolve => sidecar.once('exit', resolve))
    let output = ''
    let errors = ''
    sidecar.stdout.on('data', chunk => { output += String(chunk) })
    sidecar.stderr.on('data', chunk => { errors += String(chunk) })
    try {
      let admission = replay ?? await authorizeNativeUpdateSidecar({ ...update, sidecarPid: sidecar.pid! })
      if (cloneRecovery) {
        const root = join(config.recovery, '..', 'cloned-recovery')
        await mkdir(root, { mode: 0o700 })
        for (const file of ['journal.key', 'current.json']) await cp(join(config.recovery, file), join(root, file))
        admission = JSON.stringify({ ...JSON.parse(admission), root })
      }
      sidecar.stdin.end(admission)
      return { code: await sidecarExit, output, errors, admission }
    } finally { sidecar.kill('SIGKILL'); await sidecarExit }
  }
  const cloned = await runSidecar(undefined, true)
  assert.notEqual(cloned.code, 0)
  assert.match(cloned.errors, /another recovery root/)
  const valid = await runSidecar()
  assert.equal(valid.code, 0, valid.errors)
  assert.equal(valid.output.trim(), 'sidecar-authorized')
  const replay = await runSidecar(valid.admission)
  assert.notEqual(replay.code, 0)
  assert.match(replay.errors, /not the authenticated launched process/)
  await writeFile(config.marker, [process.argv[3], process.env.OPENFORGE_ELECTRON_USER_DATA_DIR,
    process.env.OPENFORGE_APP_DATA_DIR, process.env.OPENFORGE_SESSION_DAEMON_ROOT, 'authenticated', ''].join('\n'))
} catch (error) {
  await writeFile(config.marker, `refused: ${String(error)}`)
  process.exitCode = 1
} finally { clearTimeout(deadline) }
