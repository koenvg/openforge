import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { UpdateBundleStore } from './updateBundleStore.js'

const roots: string[] = []
export async function cleanupUpdateBundles(): Promise<void> {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
}

export async function updateBundleFixture() {
  const root = await mkdtemp(join(tmpdir(), 'of-update-bundle-'))
  roots.push(root)
  const source = join(root, 'source.app')
  for (const [name, value] of Object.entries({
    'Contents/MacOS/Open Forge': 'electron',
    'Contents/MacOS/openforge-sidecar': 'sidecar',
    'Contents/MacOS/openforge-session-daemon': 'daemon',
    'Contents/MacOS/openforge-update-helper': 'helper',
    'Contents/Resources/openforge-cli/cli.js': 'cli',
    'Contents/Resources/app/dist-electron/main.js': 'main',
  })) {
    const path = join(source, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, value, { mode: name.includes('/MacOS/') ? 0o755 : 0o644 })
  }
  return { root, source, store: new UpdateBundleStore(join(root, 'staged')) }
}
