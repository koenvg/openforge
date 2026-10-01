import { cp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { UpdateAuthorizationStore } from './updateAuthorization.js'
import { cleanupUpdateBundles, updateBundleFixture } from './updateBundle.testUtils.js'
import { preflightAuthorizedInstall } from './updateInstallPreflight.js'

afterEach(cleanupUpdateBundles)

async function fixture() {
  const { root, source, store } = await updateBundleFixture()
  const destination = join(root, 'Installed.app')
  await cp(source, destination, { recursive: true })
  const staged = await store.stage(source)
  const options = {
    root: join(root, 'authorization'), installationId: 'installation-one',
    installedBundlePath: destination, bundles: store,
    confirmLocalBuild: async () => 'approve' as const,
  }
  const authorization = new UpdateAuthorizationStore(options)
  await authorization.authorizeLocal(staged, 'operation-one')
  const target = {
    installationId: options.installationId, operationId: 'operation-one',
    manifestSha256: staged.manifestSha256, images: staged.images,
  }
  return { root, destination, staged, target, store, authorization, options }
}

it('reconstructs an authenticated install target after host restart and rechecks all staged bytes', async () => {
  const { destination, staged, target, store, options } = await fixture()
  const authorization = new UpdateAuthorizationStore(options)
  const result = await preflightAuthorizedInstall({ authorization, bundles: store, target })
  expect(result.authorization.installedBundlePath).toBe(destination)
  expect(result.staged.bundlePath).toBe(staged.bundlePath)
  expect(result.staged.images).toEqual(target.images)
  await writeFile(join(staged.bundlePath, 'Contents/MacOS/openforge-update-helper'), 'substituted helper')
  await expect(preflightAuthorizedInstall({ authorization, bundles: store, target })).rejects.toThrow('changed')
  expect(await readFile(join(destination, 'Contents/MacOS/openforge-update-helper'), 'utf8')).toBe('helper')
})
