// Private sealed Electron source, never imported by the packaged app.
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { app } from 'electron'
import { UpdateAuthorizationStore } from '../updateAuthorization.js'
import { UpdateBundleStore } from '../updateBundleStore.js'
import { prepareNativeUpdateHandoff, type NativeUpdateHandoff } from '../nativeUpdateHelper.js'
import { createSidecarLaunchConfig } from '../sidecar.js'
import { FixtureProcess } from './updateFixtureProcess.js'

const root = process.env.OPENFORGE_ELECTRON_USER_DATA_DIR!
app.setPath('userData', root)
app.setPath('sessionData', root)
app.setActivationPolicy('prohibited')
app.commandLine.appendSwitch('disable-gpu')
const deadline = setTimeout(() => app.exit(1), 150_000)
const input = createInterface({ input: process.stdin })
// Install this before preparation, so test-controller loss cannot leave a source behind.
let exitRequested = false
const requestedExit = new Promise<void>(resolve => input.on('line', command => {
  if (command === 'exit') { exitRequested = true; resolve() }
}))
input.on('close', () => { if (!exitRequested) app.exit(1) })
const config = JSON.parse(await readFile(join(root, 'host.json'), 'utf8'))
const bundles = new UpdateBundleStore(config.staging)
const authorization = new UpdateAuthorizationStore({
  root: config.authorization, installationId: config.target.installationId,
  installedBundlePath: config.destination, bundles,
})
const launch = createSidecarLaunchConfig({
  executablePath: join(config.destination, 'Contents/MacOS/openforge-sidecar'),
  processEnv: process.env,
})
const sidecar = new FixtureProcess(spawn(launch.command, [...launch.args], { env: launch.env, stdio: ['pipe', 'pipe', 'pipe'] }), root, 'source-sidecar')
let handoff: NativeUpdateHandoff | undefined
try {
  await sidecar.waitForOutput('source-ready\n', 30_000)
  process.stdout.write('source-ready\n')
  handoff = await prepareNativeUpdateHandoff({ authorization, bundles, target: config.target, recoveryRoot: config.recovery,
    controller: config.controller, source: { sidecarPid: sidecar.child.pid!, key: launch.token },
  })
  if (config.decision === 'cancel') {
    await handoff.cancel()
    try { await handoff.arm(); throw new Error('A cancelled handoff armed') }
    catch (error) { if (!(error instanceof Error) || !error.message.includes('already decided')) throw error }
    process.stdout.write('cancelled\n')
  } else {
    // Never use stdin EOF or a shutdown reply as exit proof. Await the exact owned handle.
    sidecar.child.stdin!.end('exit\n')
    await sidecar.waitForExit(10_000)
    await handoff.arm()
    process.stdout.write('armed\n')
  }
  await requestedExit
} catch (error) {
  process.stdout.write(`refused:${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await sidecar.stop()
  clearTimeout(deadline)
  app.exit(Number(process.exitCode ?? 0))
}
