import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'

async function privateBytes(path, limit, mode = 0o600) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.nlink !== 1 || metadata.uid !== process.getuid() || (metadata.mode & 0o7777) !== mode || metadata.size > limit) {
      throw new Error('Unsafe cold recovery file')
    }
    const bytes = await file.readFile()
    if (bytes.length > limit) throw new Error('Cold recovery file exceeds limit')
    return bytes
  } finally { await file.close() }
}

async function ownedRoot(root) {
  const metadata = await lstat(root)
  if (!metadata.isDirectory() || metadata.uid !== process.getuid() || (metadata.mode & 0o7777) !== 0o700 || await realpath(root) !== root) {
    throw new Error('Unsafe cold recovery root')
  }
}

async function authenticated(root, file, keyName, context) {
  await ownedRoot(root)
  const key = await privateBytes(join(root, keyName), 32)
  const envelope = JSON.parse((await privateBytes(join(root, file), 32 * 1024)).toString('utf8'))
  if (key.length !== 32 || typeof envelope.payload !== 'string' || typeof envelope.mac !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.mac)
    || !timingSafeEqual(Buffer.from(envelope.mac, 'hex'), createHmac('sha256', key).update(context).update(envelope.payload).digest())) {
    throw new Error('Invalid cold recovery authentication')
  }
  return JSON.parse(envelope.payload)
}

/** Authenticate the prior operation and installer bytes before executing retained code. */
export async function coldRecoveryHelper(profile, destination) {
  profile = await realpath(profile)
  destination = join(await realpath(dirname(destination)), destination.split('/').at(-1))
  const root = join(profile, 'updates/native')
  const record = await authenticated(root, 'current.json', 'journal.key', 'openforge-update-journal-v1\0')
  if (record.version !== 1 || typeof record.operation !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(record.operation)
    || record.destination !== destination || record.authorization !== join(profile, 'updates/cold-authority')
    || record.staging !== join(profile, 'updates/staged') || !['prepared', 'cold-replacing', 'cold-committed'].includes(record.phase)) {
    throw new Error('Invalid cold recovery operation')
  }
  const grant = await authenticated(record.authorization, `${record.operation}.json`, 'authorization.key', 'openforge-update-authorization-v1\0')
  if (grant.version !== 1 || grant.source !== 'local-build' || grant.operationId !== record.operation
    || grant.installationId !== record.installation || grant.installedBundlePath !== destination || grant.manifestSha256 !== record.targetHash
    || grant.coldInstall?.electronUserData !== profile || typeof grant.coldInstall.helperSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(grant.coldInstall.helperSha256)) {
    throw new Error('Invalid cold recovery authority')
  }
  const helper = join(root, `cold-installer-${record.operation}`)
  if (createHash('sha256').update(await privateBytes(helper, 128 * 1024 * 1024, 0o700)).digest('hex') !== grant.coldInstall.helperSha256) {
    throw new Error('Cold recovery helper differs from the approved artifact')
  }
  return helper
}
