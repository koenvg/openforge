import { createHash } from 'node:crypto'
import { chmod, cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// These are the shipped Session Protocol and checkpoint formats, not a trust claim.
export async function packageRuntimeRelease({ daemonPath, cliAssetsPath, outputPath, architecture }) {
  const architectures = { arm64: 'aarch64', x86_64: 'x86_64' }
  if (!architectures[architecture]) throw new Error(`Unsupported daemon architecture: ${architecture}`)
  await mkdir(outputPath, { recursive: true })
  const files = []
  async function copyFile(source, relative, executable = false) {
    const metadata = await lstat(source)
    if (!metadata.isFile()) throw new Error(`Runtime artifact must be a regular file: ${source}`)
    await cp(source, join(outputPath, relative), { force: false, errorOnExist: true })
    await chmod(join(outputPath, relative), executable ? 0o755 : 0o644)
    const bytes = await readFile(join(outputPath, relative))
    files.push({ path: relative, sha256: createHash('sha256').update(bytes).digest('hex'), executable })
  }
  await copyFile(daemonPath, 'openforge-session-daemon', true)
  if (cliAssetsPath) {
    await mkdir(join(outputPath, 'openforge-cli'))
    for (const name of (await readdir(cliAssetsPath)).sort()) {
      await copyFile(join(cliAssetsPath, name), `openforge-cli/${name}`)
    }
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const manifest = { format: 1, architecture: architectures[architecture], protocol: 4, stateFormat: 1, files }
  await writeFile(join(outputPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  return manifest
}
