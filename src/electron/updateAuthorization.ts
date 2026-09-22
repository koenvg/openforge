import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { StagedUpdateBundle, UpdateBundleStore } from './updateBundleStore.js'
import { updateManifestBytes } from './updateBundleManifest.js'
import { verifyPublishedAppUpdate } from './updatePublisherTrust.js'
import { confirmNativeLocalBuild } from './localBuildApproval.js'

export interface UpdateLaunchContext {
  electronUserData: string
  appData: string
  daemonRoot: string
}

export interface UpdateAuthorization {
  version: 1
  installationId: string
  operationId: string
  installedBundlePath: string
  source: 'local-build' | 'published'
  manifestSha256: string
  bundlePath: string
  launch?: Readonly<UpdateLaunchContext>
}

interface Options {
  root: string
  installationId: string
  installedBundlePath: string
  bundles: UpdateBundleStore
  launch?: UpdateLaunchContext
  /** Trusted main-process UI capability, never supplied by an IPC request. */
  confirmLocalBuild?(request: Readonly<UpdateAuthorization>): Promise<'approve' | 'cancel'>
}

const context = 'openforge-update-authorization-v1\0'

/** Records explicit authority independently from checksum-only staging. No environment bypass. */
export class UpdateAuthorizationStore {
  constructor(private readonly options: Options) {
    validateIdentity(options.installationId)
    if ([options.root, options.installedBundlePath].some(path => !isAbsolute(path) || resolve(path) !== path)) {
      throw new Error('Update authorization paths must be absolute and normalized')
    }
  }

  async authorizePublished(staged: StagedUpdateBundle, operationId: string, signature: Buffer): Promise<UpdateAuthorization> {
    validateIdentity(operationId)
    await this.options.bundles.verify(staged)
    verifyPublishedAppUpdate(updateManifestBytes(staged.manifest), signature)
    return this.persist(Object.freeze({
      version: 1, installationId: this.options.installationId, operationId,
      installedBundlePath: this.options.installedBundlePath,
      source: 'published', manifestSha256: staged.manifestSha256, bundlePath: staged.bundlePath,
      ...(this.options.launch ? { launch: parseLaunchContext(this.options.launch) } : {}),
    }))
  }

  async authorizeLocal(staged: StagedUpdateBundle, operationId: string): Promise<UpdateAuthorization> {
    validateIdentity(operationId)
    await this.options.bundles.verify(staged)
    const record: UpdateAuthorization = Object.freeze({
      version: 1, installationId: this.options.installationId, operationId,
      installedBundlePath: this.options.installedBundlePath,
      source: 'local-build', manifestSha256: staged.manifestSha256, bundlePath: staged.bundlePath,
      ...(this.options.launch ? { launch: parseLaunchContext(this.options.launch) } : {}),
    })
    const previous = await this.read(operationId)
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(record)) throw new Error('Update authorization conflicts with the previous operation')
      return previous
    }
    const confirm = this.options.confirmLocalBuild ?? confirmNativeLocalBuild
    if (await confirm(record) !== 'approve') throw new Error('Local build was not approved')
    // User interaction may take arbitrarily long. Approval never excuses changed bytes.
    await this.options.bundles.verify(staged)
    return this.persist(record)
  }

  async read(operationId: string): Promise<UpdateAuthorization | null> {
    validateIdentity(operationId)
    try { await this.checkRoot() } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    let bytes: Buffer
    try { bytes = await readPrivateFile(join(this.options.root, `${operationId}.json`), 16 * 1024) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    const key = await readPrivateFile(join(this.options.root, 'authorization.key'), 32)
    if (key.length !== 32) throw new Error('Invalid update authorization key')
    const envelope = JSON.parse(bytes.toString('utf8')) as { payload?: unknown; mac?: unknown }
    if (typeof envelope?.payload !== 'string' || typeof envelope.mac !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.mac)
      || !timingSafeEqual(Buffer.from(envelope.mac, 'hex'), mac(key, envelope.payload))) {
      throw new Error('Invalid update authorization authentication')
    }
    const record = JSON.parse(envelope.payload) as UpdateAuthorization
    if (!record || record.version !== 1 || record.installationId !== this.options.installationId
      || record.operationId !== operationId || !['local-build', 'published'].includes(record.source)
      || record.installedBundlePath !== this.options.installedBundlePath
      || typeof record.bundlePath !== 'string' || !/^[a-f0-9]{64}$/.test(record.manifestSha256)) {
      throw new Error('Invalid update authorization identity')
    }
    if (record.launch) record.launch = parseLaunchContext(record.launch)
    return Object.freeze(record)
  }

  /** Main-process capability. A fresh helper challenge binds each proof to one live pipe. */
  async helperProof(operationId: string, challenge: string, action: 'prepare' | 'install' | 'cancel' | 'commit', recoveryRoot: string, manifestSha256: string): Promise<{ payload: string; mac: string }> {
    if (!/^[a-f0-9]{64}$/.test(challenge) || !['prepare', 'install', 'cancel', 'commit'].includes(action)
      || !isAbsolute(recoveryRoot) || resolve(recoveryRoot) !== recoveryRoot) throw new Error('Invalid helper handoff request')
    const authorization = await this.read(operationId)
    if (!authorization) throw new Error('Helper handoff requires update authorization')
    if (authorization.manifestSha256 !== manifestSha256) throw new Error('Helper handoff target does not match authorization')
    const key = await readPrivateFile(join(this.options.root, 'authorization.key'), 32)
    if (key.length !== 32) throw new Error('Invalid update authorization key')
    const payload = JSON.stringify(action === 'prepare' || action === 'commit' ? {
      version: 1, challenge, action, manifestSha256, root: recoveryRoot, destination: authorization.installedBundlePath,
      authorization: this.options.root, staging: dirname(authorization.bundlePath),
      installation: authorization.installationId, operation: operationId,
    } : { version: 1, challenge, action, operation: operationId })
    return { payload, mac: createHmac('sha256', key).update('openforge-update-handoff-v1\0').update(payload).digest('hex') }
  }

  private async persist(record: UpdateAuthorization): Promise<UpdateAuthorization> {
    try { await mkdir(this.options.root, { mode: 0o700 }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    await this.checkRoot()
    const keyPath = join(this.options.root, 'authorization.key')
    try { await writePrivateFile(keyPath, randomBytes(32)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const key = await readPrivateFile(keyPath, 32)
    if (key.length !== 32) throw new Error('Invalid update authorization key')
    const payload = JSON.stringify(record)
    const envelope = JSON.stringify({ payload, mac: mac(key, payload).toString('hex') })
    try { await writePrivateFile(join(this.options.root, `${record.operationId}.json`), Buffer.from(envelope)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.read(record.operationId)
      if (JSON.stringify(existing) !== payload) throw new Error('Update authorization conflicts with the previous operation')
    }
    const directory = await open(this.options.root, 'r')
    try { await directory.sync() } finally { await directory.close() }
    return record
  }

  private async checkRoot(): Promise<void> {
    const metadata = await lstat(this.options.root)
    if (!metadata.isDirectory() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o700) {
      throw new Error('Unsafe update authorization directory')
    }
  }
}

function parseLaunchContext(value: UpdateLaunchContext): Readonly<UpdateLaunchContext> {
  const paths = [value.electronUserData, value.appData, value.daemonRoot]
  if (paths.some(path => typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path)) throw new Error('Invalid authorized update launch context')
  return Object.freeze({ electronUserData: value.electronUserData, appData: value.appData, daemonRoot: value.daemonRoot })
}

function validateIdentity(value: string): void {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(value)) throw new Error('Invalid update authorization identity')
}

function mac(key: Buffer, payload: string): Buffer {
  return createHmac('sha256', key).update(context).update(payload).digest()
}

async function readPrivateFile(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.nlink !== 1 || metadata.uid !== process.getuid?.()
      || (metadata.mode & 0o777) !== 0o600 || metadata.size > limit) throw new Error('Unsafe update authorization file')
    const buffer = Buffer.alloc(limit + 1)
    let count = 0
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, null)
      if (!bytesRead) break
      count += bytesRead
    }
    if (count > limit) throw new Error('Update authorization exceeds size limit')
    return buffer.subarray(0, count)
  } finally { await file.close() }
}

async function writePrivateFile(path: string, bytes: Buffer): Promise<void> {
  const file = await open(path, 'wx', 0o600)
  try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
}
