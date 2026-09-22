// Isolated contract fixture only. Never imported by the packaged app.
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { UpdateAuthorizationStore } from '../updateAuthorization.js'
import { UpdateBundleStore } from '../updateBundleStore.js'
import { prepareNativeUpdateHandoff } from '../nativeUpdateHelper.js'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const bundles = new UpdateBundleStore(config.staging)
const authorization = new UpdateAuthorizationStore({
  root: config.authorization, installationId: config.target.installationId,
  installedBundlePath: config.destination, bundles,
})
const input = createInterface({ input: process.stdin })
input.on('line', command => {
  if (command === 'exit') process.exit(0)
})
const handoff = await prepareNativeUpdateHandoff({ authorization, bundles, target: config.target, recoveryRoot: config.recovery })
await handoff.arm()
process.stdout.write('armed\n')
// Own all fixture lifetime: losing the test controller exits this temporary host too.
input.on('close', () => process.exit(0))
setTimeout(() => process.exit(1), 5_000)
