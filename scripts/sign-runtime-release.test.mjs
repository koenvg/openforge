import { generateKeyPairSync, verify } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { signRuntimeRelease } from './sign-runtime-release.mjs'

const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture(keyType = 'ed25519') {
  const root = await mkdtemp(join(tmpdir(), 'openforge-release-signing-'))
  roots.push(root)
  const { privateKey, publicKey } = generateKeyPairSync(keyType)
  const privateKeyPath = join(root, 'publisher.pem')
  await writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  const releaseDirectory = join(root, 'runtime')
  await mkdir(releaseDirectory)
  const manifest = Buffer.from('{"format":1,"test":"exact bytes"}\n')
  await writeFile(join(releaseDirectory, 'manifest.json'), manifest)
  return { releaseDirectory, privateKeyPath, publicKey, manifest }
}

it('writes a detached publisher signature over the exact domain-separated runtime manifest', async () => {
  const { releaseDirectory, privateKeyPath, publicKey, manifest } = await fixture()

  const signaturePath = await signRuntimeRelease({ releaseDirectory, privateKeyPath })

  expect(signaturePath).toBe(join(releaseDirectory, 'manifest.ed25519'))
  const signature = await readFile(signaturePath)
  expect(signature.length).toBe(64)
  expect(verify(null, Buffer.concat([Buffer.from('openforge-session-release-v1\0'), manifest]), publicKey, signature)).toBe(true)
  expect(verify(null, manifest, publicKey, signature)).toBe(false)
  await expect(signRuntimeRelease({ releaseDirectory, privateKeyPath })).rejects.toThrow()
  expect(await readFile(signaturePath)).toEqual(signature)
})

it.each(['wrong-key', 'public-key-permissions', 'symlink-key', 'oversized-manifest', 'key-in-artifact'])(
  'refuses unsafe publisher signing inputs: %s', async variant => {
    const options = await fixture(variant === 'wrong-key' ? 'ed448' : 'ed25519')
    if (variant === 'public-key-permissions') await chmod(options.privateKeyPath, 0o644)
    if (variant === 'symlink-key') {
      const link = `${options.privateKeyPath}.link`
      await symlink(options.privateKeyPath, link)
      options.privateKeyPath = link
    }
    if (variant === 'oversized-manifest') await writeFile(join(options.releaseDirectory, 'manifest.json'), Buffer.alloc(65537))
    if (variant === 'key-in-artifact') {
      const path = join(options.releaseDirectory, 'publisher.pem')
      await writeFile(path, await readFile(options.privateKeyPath), { mode: 0o600 })
      options.privateKeyPath = path
    }
    await expect(signRuntimeRelease(options)).rejects.toThrow()
    await expect(readFile(join(options.releaseDirectory, 'manifest.ed25519'))).rejects.toMatchObject({ code: 'ENOENT' })
  },
)
