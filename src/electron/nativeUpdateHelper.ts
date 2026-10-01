import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseUpdateTarget, type UpdateTarget } from './appUpdateVerification.js'
import type { UpdateAuthorizationStore } from './updateAuthorization.js'
import type { UpdateBundleStore } from './updateBundleStore.js'
import type { RestartTerminalController } from './restartWorkspace.js'
import { preflightAuthorizedInstall } from './updateInstallPreflight.js'
import { UpdateHelperProcess } from './updateHelperProcess.js'
import { measureUpdateBundle, updateBundleImages } from './updateBundleManifest.js'

export interface NativeUpdateHandoff {
  /** Call only after authenticated detach and verified exit of the owned Sidecar. Exit the host after acknowledgement. */
  arm(): Promise<void>
  /** Cancels before arming; never converts a detached update into a normal Quit. */
  cancel(): Promise<void>
}

/** No authenticated preparation request was sent; native runtime mutation could not start. */
export class NativeUpdateNotStarted extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'NativeUpdateNotStarted'
  }
}

/** Trusted main-process boundary. Not a renderer IPC endpoint or an update enablement switch. */
export async function prepareNativeUpdateHandoff(options: {
  authorization: UpdateAuthorizationStore
  bundles: UpdateBundleStore
  target: UpdateTarget
  recoveryRoot: string
  controller?: RestartTerminalController
}): Promise<NativeUpdateHandoff> {
  let requested = false
  let helper: UpdateHelperProcess | undefined
  let executable: string | undefined
  try {
    const target = parseUpdateTarget(options.target)
    const controller = options.controller ? Object.freeze({ ...options.controller }) : undefined
    const { authorization: store, recoveryRoot: root } = options
    const { authorization, staged } = await preflightAuthorizedInstall({ authorization: store, bundles: options.bundles, target })
    if (!isAbsolute(root) || resolve(root) !== root) throw new Error('Helper recovery root must be absolute and normalized')
    for (const bundle of [authorization.installedBundlePath, staged.bundlePath]) {
      const suffix = relative(bundle, root)
      if (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)) throw new Error('Helper recovery must be outside app bundles')
    }
    try { await mkdir(root, { mode: 0o700 }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const metadata = await lstat(root)
    if (!metadata.isDirectory() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o7777) !== 0o700) {
      throw new Error('Unsafe helper recovery directory')
    }
    executable = join(root, `helper-${target.operationId}-${randomUUID()}`)
    await copyVerifiedHelper(join(staged.bundlePath, 'Contents/MacOS/openforge-update-helper'), executable, target.images.helper)
    helper = new UpdateHelperProcess(executable)
    const challenge = handoffChallenge(await helper.receive(10_000), 'install')
    const proof = (action: 'prepare' | 'install' | 'cancel') => store.helperProof(target.operationId, challenge, action, root, target.manifestSha256, controller)
    const request = await proof('prepare')
    // A failed write may still deliver authority. Only failures before this point are unsent.
    requested = true
    await helper.send(request)
    expectStatus(await helper.receive(), 'prepared', target.operationId)
    return preparedHandoff(helper, executable, target.operationId, decision => proof(decision === 'arm' ? 'install' : 'cancel'))
  } catch (error) {
    await helper?.stop()
    if (executable) await rm(executable, { force: true })
    if (!requested) throw new NativeUpdateNotStarted(error)
    throw error
  }
}

/** Prepare a fresh native-owned app lifetime, never ordinary app.relaunch or database rollback. */
export async function prepareNativeUpdateRelaunch(options: Omit<InstalledUpdateOptions, 'controller'>): Promise<NativeUpdateHandoff> {
  const { target, grant, root } = await installedTarget(options)
  const executable = join(root, `relaunch-${target.operationId}-${randomUUID()}`)
  let helper: UpdateHelperProcess | undefined
  try {
    await copyVerifiedHelper(join(grant.installedBundlePath, 'Contents/MacOS/openforge-update-helper'), executable, target.images.helper)
    helper = new UpdateHelperProcess(executable)
    const challenge = handoffChallenge(await helper.receive(10_000), 'relaunch')
    const proof = (action: 'prepare-relaunch' | 'relaunch' | 'cancel') => options.authorization.helperProof(target.operationId, challenge, action, root, target.manifestSha256)
    await helper.send(await proof('prepare-relaunch'))
    expectStatus(await helper.receive(), 'prepared', target.operationId)
    return preparedHandoff(helper, executable, target.operationId, decision => proof(decision === 'arm' ? 'relaunch' : 'cancel'))
  } catch (error) {
    await helper?.stop()
    await rm(executable, { force: true })
    throw error
  }
}

function handoffChallenge(hello: Record<string, unknown>, purpose: 'install' | 'relaunch'): string {
  if (hello.version !== 2) throw new Error('Unsupported update helper protocol')
  if (!Array.isArray(hello.capabilities) || !hello.capabilities.includes('relaunch')) throw new Error('Update helper does not support authenticated relaunch')
  if (!hello.capabilities.includes('launch-gate')) throw new Error('Update helper does not support a durable launch gate')
  if (purpose === 'install' && !hello.capabilities.includes('atomic-replace')) throw new Error('Update helper does not support atomic app replacement')
  if (typeof hello.challenge !== 'string' || !/^[a-f0-9]{64}$/.test(hello.challenge)) throw new Error('Invalid helper challenge')
  return hello.challenge
}

function preparedHandoff(child: UpdateHelperProcess, executable: string, operationId: string, proof: (decision: 'arm' | 'cancel') => ReturnType<UpdateAuthorizationStore['helperProof']>): NativeUpdateHandoff {
  let decided = false
  async function decide(action: 'arm' | 'cancel'): Promise<void> {
    if (decided) throw new Error('Helper handoff already decided')
    decided = true
    try {
      await child.send(await proof(action))
      expectStatus(await child.receive(), action === 'arm' ? 'armed' : 'cancelled', operationId)
      if (action === 'arm') {
        // Retain the verified private image for recovery. Pipe closure is not host exit proof.
        child.release()
        return
      }
    } catch (error) {
      await child.stop()
      await rm(executable, { force: true })
      throw error
    }
    await child.stop()
    await rm(executable, { force: true })
  }
  return { arm: () => decide('arm'), cancel: () => decide('cancel') }
}

/** Called by the trusted coordinator only after runtime reconciliation and every window restores. */
export async function commitNativeUpdate(options: InstalledUpdateOptions): Promise<void> {
  await runInstalledHelper(options, 'commit')
}

/** Authenticate this target process through the native journal before backend startup. */
export async function verifyNativeUpdateLaunch(options: Omit<InstalledUpdateOptions, 'controller'>): Promise<void> {
  await runInstalledHelper(options, 'verify-launch')
}

/** Native observation of the current app, admitted Sidecar and authenticated daemon. */
export async function verifyNativeUpdateReadiness(options: InstalledUpdateOptions): Promise<void> {
  await runInstalledHelper(options, 'verify-ready')
}

/** Return native child admission for its inherited stdin, never for renderer IPC. */
export async function authorizeNativeUpdateSidecar(options: Omit<InstalledUpdateOptions, 'controller'> & { sidecarPid: number }): Promise<string> {
  if (!Number.isSafeInteger(options.sidecarPid) || options.sidecarPid <= 1) throw new Error('Invalid owned Sidecar pid')
  const result = await runInstalledHelper(options, 'register-sidecar', options.sidecarPid)
  if (!result.admission || typeof result.admission !== 'object') throw new Error('Missing native Sidecar admission')
  return JSON.stringify(result.admission)
}

interface InstalledUpdateOptions {
  authorization: UpdateAuthorizationStore; target: UpdateTarget; recoveryRoot: string; controller?: RestartTerminalController
}

async function installedTarget(options: Omit<InstalledUpdateOptions, 'controller'>) {
  const target = parseUpdateTarget(options.target)
  const grant = await options.authorization.read(target.operationId)
  if (!grant || grant.installationId !== target.installationId || grant.manifestSha256 !== target.manifestSha256) throw new Error('Installed update has no matching authorization')
  const images = updateBundleImages(await measureUpdateBundle(grant.installedBundlePath))
  if (Object.keys(images).some(name => images[name as keyof typeof images] !== target.images[name as keyof typeof images])) throw new Error('Installed update image changed')
  const root = options.recoveryRoot
  const metadata = await lstat(root)
  if (!isAbsolute(root) || resolve(root) !== root || !metadata.isDirectory() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o7777) !== 0o700) throw new Error('Unsafe helper recovery directory')
  return { target, grant, root }
}

async function runInstalledHelper(options: InstalledUpdateOptions, action: 'commit' | 'verify-launch' | 'verify-ready' | 'register-sidecar', sidecarPid?: number): Promise<Record<string, unknown>> {
  const controller = options.controller ? Object.freeze({ ...options.controller }) : undefined
  const { target, grant, root } = await installedTarget(options)
  const executable = join(root, `${action}-${target.operationId}-${randomUUID()}`)
  let helper: UpdateHelperProcess | undefined
  try {
    await copyVerifiedHelper(join(grant.installedBundlePath, 'Contents/MacOS/openforge-update-helper'), executable, target.images.helper)
    const pendingUntil = Date.now() + 5_000
    let firstProbe = true
    for (;;) {
      helper = new UpdateHelperProcess(executable)
      const hello = await helper.receive(firstProbe ? 10_000 : 2_000)
      firstProbe = false
      if (hello.version !== 2) throw new Error('Unsupported update helper protocol')
      if (typeof hello.challenge !== 'string') throw new Error('Invalid helper challenge')
      await helper.send(await options.authorization.helperProof(target.operationId, hello.challenge, action, root, target.manifestSha256, controller, sidecarPid))
      const result = await helper.receive()
      if (action === 'verify-launch' && result.status === 'launch-pending' && result.operation === target.operationId) {
        await helper.stop()
        helper = undefined
        if (Date.now() >= pendingUntil) throw new Error('Native installation ownership was not released for startup')
        await new Promise(resolve => setTimeout(resolve, 50))
        continue
      }
      const expected = { commit: 'committed', 'verify-launch': 'launch-verified', 'verify-ready': 'target-ready', 'register-sidecar': 'sidecar-registered' }[action]
      expectStatus(result, expected, target.operationId)
      return result
    }
  } finally {
    await helper?.stop()
    await rm(executable, { force: true })
  }
}

function expectStatus(value: Record<string, unknown>, expected: string, operation: string): void {
  if (value.status !== expected || value.operation !== operation) throw new Error(`Update helper did not acknowledge ${expected}`)
}

async function copyVerifiedHelper(source: string, destination: string, expected: string): Promise<void> {
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await input.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o7022 || !(stat.mode & 0o111)) throw new Error('Unsafe helper image')
    const output = await open(destination, 'wx', 0o500)
    try {
      const hash = createHash('sha256')
      const buffer = Buffer.alloc(64 * 1024)
      let total = 0
      let count: number
      while ((count = (await input.read(buffer, 0, buffer.length, null)).bytesRead)) {
        total += count
        if (total > 64 * 1024 ** 2) throw new Error('Helper image exceeds size limit')
        const chunk = buffer.subarray(0, count)
        hash.update(chunk)
        await output.writeFile(chunk)
      }
      if (hash.digest('hex') !== expected) throw new Error('Authorized helper image changed')
      await output.sync()
    } finally { await output.close() }
  } finally { await input.close() }
  const directory = await open(resolve(destination, '..'), 'r')
  try { await directory.sync() } finally { await directory.close() }
}
