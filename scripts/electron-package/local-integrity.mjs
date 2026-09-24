import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

// Ad-hoc integrity only. Publisher authorization and release signing are separate gates.
export async function sealLocalApplication(appPath) {
  if (process.platform !== 'darwin') throw new Error('Local macOS integrity sealing requires macOS')
  const options = { timeout: 30_000, maxBuffer: 1024 * 1024, env: { PATH: '/usr/bin:/bin' } }
  const codesign = args => execute('/usr/bin/codesign', args, options)
  // Seal code bundles inside-out. Do not deep-sign arbitrary executables: retained
  // daemon manifests must keep their original bytes.
  async function sealBundles(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(directory, entry.name)
      await sealBundles(path)
      if (entry.name.endsWith('.app') || entry.name.endsWith('.framework')) {
        await codesign(['--force', '--sign', '-', '--timestamp=none', '--preserve-metadata=entitlements', path])
      }
    }
  }
  await sealBundles(join(appPath, 'Contents/Frameworks'))
  await codesign(['--force', '--sign', '-', '--timestamp=none', '--preserve-metadata=entitlements', appPath])
  await codesign(['--verify', '--deep', '--strict', appPath])
}
