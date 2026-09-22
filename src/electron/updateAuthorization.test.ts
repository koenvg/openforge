import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { UpdateAuthorizationStore } from './updateAuthorization.js'
import { cleanupUpdateBundles, updateBundleFixture } from './updateBundle.testUtils.js'

afterEach(cleanupUpdateBundles)

it('requires explicit local-build approval and binds it to the exact installation, operation and staged bytes', async () => {
  const { root, source, store } = await updateBundleFixture()
  const staged = await store.stage(source)
  const options = { root: join(root, 'authorization'), installationId: 'installation-one', installedBundlePath: join(root, 'Installed.app'), bundles: store }
  const denied = new UpdateAuthorizationStore({ ...options, confirmLocalBuild: async () => 'cancel' as const })
  await expect(denied.authorizeLocal(staged, 'operation-one')).rejects.toThrow('not approved')
  await expect(denied.read('operation-one')).resolves.toBeNull()

  const approved = new UpdateAuthorizationStore({ ...options, confirmLocalBuild: async request => {
    expect(request.manifestSha256).toBe(staged.manifestSha256)
    expect(request.installationId).toBe('installation-one')
    expect(request.operationId).toBe('operation-one')
    return 'approve'
  } })
  const record = await approved.authorizeLocal(staged, 'operation-one')
  expect(record.source).toBe('local-build')
  expect(record.manifestSha256).toBe(staged.manifestSha256)
  await expect(approved.helperProof('operation-one', 'a'.repeat(64), 'prepare', join(root, 'recovery'), '0'.repeat(64))).rejects.toThrow('target')
  await expect(denied.read('operation-one')).resolves.toEqual(record)
  await expect(denied.read('operation-two')).resolves.toBeNull()
  const foreign = new UpdateAuthorizationStore({ ...options, installationId: 'installation-two', confirmLocalBuild: async () => 'cancel' as const })
  await expect(foreign.read('operation-one')).rejects.toThrow('authorization')
  const retargeted = new UpdateAuthorizationStore({ ...options, installedBundlePath: join(root, 'Other.app'), confirmLocalBuild: async () => 'cancel' as const })
  await expect(retargeted.read('operation-one')).rejects.toThrow('identity')
})

it('never converts failed publisher verification into a local approval prompt', async () => {
  const { root, source, store } = await updateBundleFixture()
  const staged = await store.stage(source)
  let prompts = 0
  const authorization = new UpdateAuthorizationStore({
    root: join(root, 'authorization'), installationId: 'installation-one', bundles: store,
    installedBundlePath: join(root, 'Installed.app'),
    confirmLocalBuild: async () => { prompts++; return 'approve' },
  })
  await expect(authorization.authorizePublished(staged, 'operation-one', Buffer.alloc(64))).rejects.toThrow('publisher')
  expect(prompts).toBe(0)
  await expect(authorization.read('operation-one')).resolves.toBeNull()
})

it('rejects changed bytes after the user approves and never writes an authorization', async () => {
  const { root, source, store } = await updateBundleFixture()
  const staged = await store.stage(source)
  const authorization = new UpdateAuthorizationStore({
    root: join(root, 'authorization'), installationId: 'installation-one', bundles: store,
    installedBundlePath: join(root, 'Installed.app'),
    confirmLocalBuild: async () => {
      await writeFile(join(staged.bundlePath, 'Contents/Resources/app/dist-electron/main.js'), 'changed while prompting')
      return 'approve'
    },
  })
  await expect(authorization.authorizeLocal(staged, 'operation-one')).rejects.toThrow('changed')
  await expect(authorization.read('operation-one')).resolves.toBeNull()
})

it('authenticates saved authorizations and rejects replay under another operation', async () => {
  const { root, source, store } = await updateBundleFixture()
  const staged = await store.stage(source)
  const directory = join(root, 'authorization')
  const authorization = new UpdateAuthorizationStore({
    root: directory, installationId: 'installation-one', bundles: store, confirmLocalBuild: async () => 'approve',
    installedBundlePath: join(root, 'Installed.app'),
  })
  await authorization.authorizeLocal(staged, 'operation-one')
  const path = join(directory, 'operation-one.json')
  const bytes = await readFile(path)
  await writeFile(join(directory, 'operation-two.json'), bytes, { mode: 0o600 })
  await expect(authorization.read('operation-two')).rejects.toThrow('identity')
  const envelope = JSON.parse(bytes.toString('utf8'))
  envelope.payload = envelope.payload.replace(staged.manifestSha256, '0'.repeat(64))
  await writeFile(path, JSON.stringify(envelope))
  await expect(authorization.read('operation-one')).rejects.toThrow('authentication')
})

it('does not issue a helper handoff proof without an existing authorization', async () => {
  const { root, store } = await updateBundleFixture()
  const authorization = new UpdateAuthorizationStore({
    root: join(root, 'authorization'), installationId: 'installation-one', bundles: store,
    installedBundlePath: join(root, 'Installed.app'),
  })
  await expect(authorization.helperProof('operation-one', 'a'.repeat(64), 'prepare', join(root, 'recovery'), '0'.repeat(64))).rejects.toThrow('authorization')
})
