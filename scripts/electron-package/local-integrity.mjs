import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const options = { timeout: 30_000, maxBuffer: 1024 * 1024, env: { PATH: '/usr/bin:/bin' } }
const codesign = args => execute('/usr/bin/codesign', args, options)

// Prepare only copied native entry points, before the retained manifest records their bytes.
export async function prepareLocalApplication(appPath) {
  if (process.platform !== 'darwin') throw new Error('Local macOS integrity sealing requires macOS')
  for (const name of ['openforge-sidecar', 'openforge-session-daemon', 'openforge-update-helper']) {
    const path = join(appPath, 'Contents/MacOS', name)
    try {
      await codesign(['--verify', '--strict', path])
    } catch (error) {
      // Preserve valid signatures and refuse invalid code; only unsigned code may be signed.
      if (!error.stderr?.split('\n').includes(`${path}: code object is not signed at all`)) throw error
      await codesign(['--sign', '-', '--timestamp=none', path])
    }
  }
}

// Ad-hoc integrity only. Publisher authorization and release signing are separate gates.
export async function sealLocalApplication(appPath) {
  if (process.platform !== 'darwin') throw new Error('Local macOS integrity sealing requires macOS')
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
  // Electron's x64 template ships this nested helper unsigned. Seal it before
  // its enclosing framework, without touching the retained runtime binaries.
  await codesign([
    '--force', '--sign', '-', '--timestamp=none', '--preserve-metadata=entitlements',
    join(appPath, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler'),
  ])
  await sealBundles(join(appPath, 'Contents/Frameworks'))
  await codesign(['--force', '--sign', '-', '--timestamp=none', '--preserve-metadata=entitlements', appPath])
  await codesign(['--verify', '--deep', '--strict', appPath])
}
