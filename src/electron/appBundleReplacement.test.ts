import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AppBundleReplacement } from './appBundleReplacement'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'openforge-bundle-helper-'))
  roots.push(root)
  const installed = join(root, 'Open Forge.app')
  const staged = join(root, 'staged.app')
  for (const [path, content] of [[installed, 'old executable'], [staged, 'new executable']]) {
    await mkdir(path)
    await writeFile(join(path, 'executable'), content)
  }
  const digest = (content: string) => createHash('sha256').update(content).digest('hex')
  const expected = digest('new executable')
  const paths = { installed, staged, stateRoot: join(root, 'state'), operationId: 'operation-one' }
  // The external trust boundary would verify a signed bundle manifest. This fixture
  // measures real file bytes, but does not claim to verify a production publisher.
  const authority = {
    verify: async (path: string) => {
      const content = await readFile(join(path, 'executable'), 'utf8')
      if (digest(content) !== expected) throw new Error('Target artifact verification failed')
    },
    waitForExit: async () => {},
    launch: async () => {},
  }
  return { paths, authority }
}

it('retains the installed app when target verification fails before replacement', async () => {
  const { paths, authority } = await fixture()
  await writeFile(join(paths.staged, 'executable'), 'tampered executable')
  const replacement = new AppBundleReplacement(paths)
  await expect(replacement.run(authority)).rejects.toThrow('artifact verification')
  expect(await readFile(join(paths.installed, 'executable'), 'utf8')).toBe('old executable')
  expect(await replacement.status()).toBeNull()
})

it('replaces the app only after exit and retains the old bundle without committing the update', async () => {
  const { paths, authority } = await fixture()
  let exited = false
  let launched = false
  authority.waitForExit = async () => { exited = true }
  authority.launch = async () => {
    expect(exited).toBe(true)
    expect(await readFile(join(paths.installed, 'executable'), 'utf8')).toBe('new executable')
    launched = true
  }
  const replacement = new AppBundleReplacement(paths)
  await replacement.run(authority)
  expect(launched).toBe(true)
  const status = await replacement.status()
  expect(status?.phase).toBe('awaiting-readiness')
  expect(await readFile(join(status!.backup, 'executable'), 'utf8')).toBe('old executable')
  expect(await new AppBundleReplacement(paths).status()).toEqual(status)
})

it('restores the old bundle if installed target verification fails before launch', async () => {
  const { paths, authority } = await fixture()
  const verify = authority.verify
  authority.verify = async path => {
    if (path === paths.installed) await writeFile(join(path, 'executable'), 'corrupted during replacement')
    await verify(path)
  }
  const replacement = new AppBundleReplacement(paths)
  await expect(replacement.run(authority)).rejects.toThrow('artifact verification')
  expect(await readFile(join(paths.installed, 'executable'), 'utf8')).toBe('old executable')
  expect((await replacement.status())?.phase).toBe('restored')
})

it('keeps the new app in explicit recovery if launch acknowledgement fails after it may have run', async () => {
  const { paths, authority } = await fixture()
  authority.launch = async () => { throw new Error('Launch acknowledgement lost') }
  const replacement = new AppBundleReplacement(paths)
  await expect(replacement.run(authority)).rejects.toThrow('Launch acknowledgement lost')
  expect(await readFile(join(paths.installed, 'executable'), 'utf8')).toBe('new executable')
  const status = await replacement.status()
  expect(status?.phase).toBe('recovery')
  expect(await readFile(join(status!.backup, 'executable'), 'utf8')).toBe('old executable')
})

it('refuses overlapping helper operations targeting the same installation', async () => {
  const { paths, authority } = await fixture()
  let releaseExit!: () => void
  let waiting!: () => void
  const entered = new Promise<void>(resolve => { waiting = resolve })
  const exit = new Promise<void>(resolve => { releaseExit = resolve })
  const first = new AppBundleReplacement(paths).run({ ...authority, waitForExit: async () => { waiting(); await exit } })
  await entered
  try {
    await expect(new AppBundleReplacement({ ...paths, operationId: 'operation-two' }).run(authority)).rejects.toThrow('already')
  } finally {
    releaseExit()
    await first
  }
})

it('refuses a staged bundle symlink without changing either installation', async () => {
  const { paths, authority } = await fixture()
  const other = join(dirname(paths.staged), 'other.app')
  await mkdir(other)
  await writeFile(join(other, 'executable'), 'new executable')
  await rm(paths.staged, { recursive: true })
  await symlink(other, paths.staged)
  await expect(new AppBundleReplacement(paths).run(authority)).rejects.toThrow('directory')
  expect(await readFile(join(paths.installed, 'executable'), 'utf8')).toBe('old executable')
  expect(await readFile(join(other, 'executable'), 'utf8')).toBe('new executable')
})

it('requires replacement state outside the installed and staged app bundles', async () => {
  const { paths } = await fixture()
  for (const bundle of [paths.installed, paths.staged]) {
    expect(() => new AppBundleReplacement({ ...paths, stateRoot: join(bundle, 'state') })).toThrow('outside')
  }
})

it('never overwrites a pre-existing retained bundle', async () => {
  const { paths, authority } = await fixture()
  await mkdir(`${paths.installed}.retained-${paths.operationId}`)
  await expect(new AppBundleReplacement(paths).run(authority)).rejects.toThrow('already exists')
  expect(await readFile(join(paths.installed, 'executable'), 'utf8')).toBe('old executable')
})

it('does not treat an invalid recovery record as permission for another replacement', async () => {
  const { paths, authority } = await fixture()
  await mkdir(paths.stateRoot)
  await writeFile(join(paths.stateRoot, 'app-replacement.json'), 'null')
  await expect(new AppBundleReplacement(paths).run(authority)).rejects.toThrow('Invalid replacement record')
  expect(await readFile(join(paths.installed, 'executable'), 'utf8')).toBe('old executable')
})
