import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { UpdateBundleStore } from './updateBundleStore.js'
import { cleanupUpdateBundles, updateBundleFixture as fixture } from './updateBundle.testUtils.js'

afterEach(cleanupUpdateBundles)

it('stages the entire app outside its source and detects changes to non-executable resources', async () => {
  const { source, store } = await fixture()
  const staged = await store.stage(source)
  await rm(source, { recursive: true })
  await expect(store.verify(staged)).resolves.toBeUndefined()
  expect(await readFile(join(staged.bundlePath, 'Contents/MacOS/openforge-sidecar'), 'utf8')).toBe('sidecar')
  expect(staged.manifestSha256).toMatch(/^[a-f0-9]{64}$/)
  await writeFile(join(staged.bundlePath, 'Contents/Resources/app/dist-electron/main.js'), 'changed')
  await expect(store.verify(staged)).rejects.toThrow('changed')
})

it('preserves internal framework symlinks but refuses links outside the complete bundle', async () => {
  const { source, store, root } = await fixture()
  await symlink('openforge-sidecar', join(source, 'Contents/MacOS/linked-helper'))
  const staged = await store.stage(source)
  await expect(store.verify(staged)).resolves.toBeUndefined()
  await writeFile(join(root, 'outside'), 'outside')
  await symlink(join(root, 'outside'), join(source, 'Contents/MacOS/escape'))
  await expect(store.stage(source)).rejects.toThrow('symlink')
})

it('refuses foreign staging records and staging inside the source bundle', async () => {
  const { source, store, root } = await fixture()
  await expect(new UpdateBundleStore(join(source, 'nested')).stage(source)).rejects.toThrow('outside')
  const staged = await store.stage(source)
  await expect(new UpdateBundleStore(join(root, 'other-store')).verify(staged)).rejects.toThrow('staging')
})

it('refuses unsafe source and staging-directory permissions', async () => {
  const { source, store, root } = await fixture()
  await chmod(join(source, 'Contents/MacOS/openforge-sidecar'), 0o777)
  await expect(store.stage(source)).rejects.toThrow('permissions')
  await chmod(join(source, 'Contents/MacOS/openforge-sidecar'), 0o755)
  await mkdir(join(root, 'staged'), { mode: 0o755 })
  await expect(store.stage(source)).rejects.toThrow('staging')
})

it('refuses a target missing one of the required app, Sidecar, daemon or CLI components', async () => {
  const { source, store } = await fixture()
  await rm(join(source, 'Contents/MacOS/openforge-session-daemon'))
  await expect(store.stage(source)).rejects.toThrow('daemon')
})

it('rejects substituted executable identities in an otherwise unchanged staging handle', async () => {
  const { source, store } = await fixture()
  const staged = await store.stage(source)
  await expect(store.verify({ ...staged, images: { ...staged.images, daemon: '0'.repeat(64) } })).rejects.toThrow('identities')
})

it('refuses a complete-app target without its updater helper', async () => {
  const { source, store } = await fixture()
  await rm(join(source, 'Contents/MacOS/openforge-update-helper'), { force: true })
  await expect(store.stage(source)).rejects.toThrow('openforge-update-helper')
})

it('refuses a target without the Electron executable even when its JavaScript entrypoint exists', async () => {
  const { source, store } = await fixture()
  await rm(join(source, 'Contents/MacOS/Open Forge'))
  await expect(store.stage(source)).rejects.toThrow('Open Forge')
})
