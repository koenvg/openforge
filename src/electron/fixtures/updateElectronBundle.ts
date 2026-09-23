// Private Electron runtime for native updater contracts; never launches a developer app.
import { execFileSync } from 'node:child_process'
import { cp, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

export async function addElectronRuntime(bundle: string, home: string): Promise<void> {
  const executable = createRequire(import.meta.url)('electron') as string
  await cp(resolve(executable, '../../..'), bundle, { recursive: true, verbatimSymlinks: true })
  await rename(join(bundle, 'Contents/MacOS/Electron'), join(bundle, 'Contents/MacOS/Open Forge'))
  await writeFile(join(bundle, 'Contents/Resources/app/package.json'), JSON.stringify({
    name: 'openforge-private-update-target', type: 'module', main: 'dist-electron/target.mjs',
  }))
  const options = { env: { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: home }, timeout: 30_000 }
  const plist = join(bundle, 'Contents/Info.plist')
  execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleExecutable Open Forge', plist], options)
  execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleIdentifier test.openforge.private-update-target', plist], options)
  // Test-only ad-hoc integrity seal. This is not publisher authorization.
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', bundle], options)
}
