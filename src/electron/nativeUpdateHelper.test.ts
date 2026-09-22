// @vitest-environment node
import { cp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { UpdateAuthorizationStore } from './updateAuthorization.js'
import { cleanupUpdateBundles, updateBundleFixture } from './updateBundle.testUtils.js'
import { prepareNativeUpdateHandoff } from './nativeUpdateHelper.js'

afterEach(cleanupUpdateBundles)

it('rejects changed helper bytes before starting any helper process', async () => {
  const { root, source, store } = await updateBundleFixture()
  const destination = join(root, 'Installed.app')
  await cp(source, destination, { recursive: true })
  const staged = await store.stage(source)
  const authorization = new UpdateAuthorizationStore({
    root: join(root, 'authorization'), installationId: 'installation-one', installedBundlePath: destination,
    bundles: store, confirmLocalBuild: async () => 'approve',
  })
  await authorization.authorizeLocal(staged, 'operation-one')
  await writeFile(join(staged.bundlePath, 'Contents/MacOS/openforge-update-helper'), 'tampered helper')
  await expect(prepareNativeUpdateHandoff({
    authorization, bundles: store, recoveryRoot: join(root, 'recovery'),
    target: { installationId: 'installation-one', operationId: 'operation-one', manifestSha256: staged.manifestSha256, images: staged.images },
  })).rejects.toThrow('changed')
})
