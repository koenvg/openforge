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
  })).rejects.toMatchObject({ name: 'NativeUpdateNotStarted', message: expect.stringContaining('changed') })
})

it.skipIf(process.platform === 'win32').each([
  { version: 1, capabilities: [], refusal: 'helper protocol', sent: false },
  { version: 2, capabilities: [], refusal: 'authenticated relaunch', sent: false },
  { version: 2, capabilities: ['relaunch'], refusal: 'durable launch gate', sent: false },
  { version: 2, capabilities: ['relaunch', 'launch-gate'], refusal: 'atomic app replacement', sent: false },
  { version: 2, capabilities: ['relaunch', 'launch-gate', 'atomic-replace'], refusal: 'acknowledge prepared', sent: true },
])('distinguishes an unsent preparation from an uncertain rejection: $refusal', async ({ version, capabilities, refusal, sent }) => {
  const { root, source, store } = await updateBundleFixture()
  const destination = join(root, 'Installed.app')
  await cp(source, destination, { recursive: true })
  await writeFile(join(source, 'Contents/MacOS/openforge-update-helper'), `#!${process.execPath}\n
process.stdout.write(JSON.stringify({version: ${version}, capabilities: ${JSON.stringify(capabilities)}, challenge: 'a'.repeat(64)}) + '\\n');
require('node:readline').createInterface({input: process.stdin}).on('line', line => {
  const request = JSON.parse(JSON.parse(line).payload);
  if (${sent}) { process.stdout.write(JSON.stringify({error: 'refused'}) + '\\n'); return; }
  process.stdout.write(JSON.stringify({status: request.action === 'cancel' ? 'cancelled' : 'prepared', operation: request.operation}) + '\\n');
});\n`, { mode: 0o755 })
  const staged = await store.stage(source)
  const authorization = new UpdateAuthorizationStore({
    root: join(root, 'authorization'), installationId: 'installation-one', installedBundlePath: destination,
    launch: { electronUserData: root, appData: root, daemonRoot: root }, bundles: store, confirmLocalBuild: async () => 'approve',
  })
  await authorization.authorizeLocal(staged, 'operation-one')
  await expect(prepareNativeUpdateHandoff({
    authorization, bundles: store, recoveryRoot: join(root, 'recovery'),
    target: { installationId: 'installation-one', operationId: 'operation-one', manifestSha256: staged.manifestSha256, images: staged.images },
  }).then(async handoff => { await handoff.cancel(); throw new Error('A refusing helper was accepted') })).rejects.toMatchObject({
    name: sent ? 'Error' : 'NativeUpdateNotStarted', message: expect.stringContaining(refusal),
  })
})
