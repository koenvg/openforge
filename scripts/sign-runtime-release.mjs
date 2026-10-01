import { createPrivateKey, sign } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Offline publisher operation. Neither the key nor this signer ships in the runtime. */
export async function signRuntimeRelease({ releaseDirectory, privateKeyPath }) {
  const root = await realpath(releaseDirectory)
  const keyLocation = await realpath(privateKeyPath)
  const suffix = relative(root, keyLocation)
  if (!suffix || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))) {
    throw new Error('Publisher private key must be outside the runtime artifact')
  }
  const manifest = await readSigningInput(join(root, 'manifest.json'), 64 * 1024)
  const key = createPrivateKey(await readSigningInput(privateKeyPath, 16 * 1024, true))
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Publisher signing requires an Ed25519 key')
  const message = Buffer.concat([Buffer.from('openforge-session-release-v1\0'), manifest])
  const signature = sign(null, message, key)
  const signaturePath = join(releaseDirectory, 'manifest.ed25519')
  await writeFile(signaturePath, signature, { flag: 'wx', mode: 0o644 })
  return signaturePath
}

async function readSigningInput(path, limit, privateKey = false) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > limit
      || (privateKey && (metadata.mode & 0o077 || metadata.uid !== process.getuid()))) {
      throw new Error('Unsafe publisher signing input')
    }
    const bytes = Buffer.alloc(limit + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > limit) throw new Error('Publisher signing input exceeds its size limit')
    return bytes.subarray(0, length)
  } finally {
    await file.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [releaseDirectory, privateKeyPath, ...extra] = process.argv.slice(2)
  if (!releaseDirectory || !privateKeyPath || extra.length) {
    console.error('Usage: node scripts/sign-runtime-release.mjs <runtime-directory> <private-key-file>')
    process.exitCode = 1
  } else {
    try {
      console.log(await signRuntimeRelease({ releaseDirectory, privateKeyPath }))
    } catch {
      // Do not expose key contents or crypto decoder diagnostics in CI logs.
      console.error('Runtime release signing failed; no existing signature was replaced')
      process.exitCode = 1
    }
  }
}
