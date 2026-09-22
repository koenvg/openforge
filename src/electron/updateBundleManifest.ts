import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, readlink, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { UpdateImages } from './appUpdateVerification.js'

export interface UpdateBundleEntry {
  path: string
  kind: 'directory' | 'file' | 'symlink'
  mode: number
  sha256?: string
  target?: string
}

export interface UpdateBundleManifest {
  format: 1
  entries: UpdateBundleEntry[]
}

export function updateManifestBytes(manifest: UpdateBundleManifest): Buffer {
  return Buffer.from(JSON.stringify(manifest))
}

export function updateManifestId(manifest: UpdateBundleManifest): string {
  return createHash('sha256').update(updateManifestBytes(manifest)).digest('hex')
}

/** Required packaged components; the app identity also covers every framework and resource. */
export function updateBundleImages(manifest: UpdateBundleManifest): UpdateImages {
  const component = (path: string, executable = false): string => {
    const entry = manifest.entries.find(entry => entry.path === path && entry.kind === 'file')
    if (!entry?.sha256 || (executable && !(entry.mode & 0o111))) throw new Error(`Update bundle is missing a usable ${path}`)
    return entry.sha256
  }
  component('Contents/MacOS/Open Forge', true)
  component('Contents/Resources/app/dist-electron/main.js')
  component('Contents/Resources/openforge-cli/cli.js')
  const cliEntries = manifest.entries.filter(entry => entry.path.startsWith('Contents/Resources/openforge-cli/'))
  return {
    app: updateManifestId(manifest),
    sidecar: component('Contents/MacOS/openforge-sidecar', true),
    daemon: component('Contents/MacOS/openforge-session-daemon', true),
    cli: updateManifestId({ format: 1, entries: cliEntries }),
    helper: component('Contents/MacOS/openforge-update-helper', true),
  }
}

/** Hashes all bundle resources, not just executables or display versions. Runs no target code. */
export async function measureUpdateBundle(bundle: string): Promise<UpdateBundleManifest> {
  if (!(await lstat(bundle)).isDirectory()) throw new Error('Update bundle root must be a real directory')
  bundle = await realpath(bundle)
  const entries: UpdateBundleEntry[] = []
  let totalBytes = 0
  const pending = ['']
  while (pending.length) {
    const relative = pending.pop()!
    const path = join(bundle, relative)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) {
      const target = await readlink(path)
      const lexical = resolve(dirname(path), target)
      if (isAbsolute(target) || !inside(bundle, lexical) || !inside(bundle, await realpath(path))) {
        throw new Error('Update bundle symlink escapes its bundle')
      }
      entries.push({ path: relative, kind: 'symlink', mode: 0, target })
    } else if (metadata.mode & 0o7022) {
      throw new Error('Unsafe update bundle permissions')
    } else if (metadata.isDirectory()) {
      entries.push({ path: relative, kind: 'directory', mode: metadata.mode & 0o777 })
      for (const name of (await readdir(path)).sort().reverse()) pending.push(relative ? `${relative}/${name}` : name)
    } else if (metadata.isFile()) {
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        const current = await file.stat()
        if (!current.isFile() || current.nlink !== 1 || current.mode & 0o7022) throw new Error('Unsafe update bundle file')
        const hash = createHash('sha256')
        const buffer = Buffer.alloc(64 * 1024)
        let count: number
        while ((count = (await file.read(buffer, 0, buffer.length, null)).bytesRead)) {
          totalBytes += count
          if (totalBytes > 4 * 1024 ** 3) throw new Error('Update bundle exceeds size limit')
          hash.update(buffer.subarray(0, count))
        }
        entries.push({ path: relative, kind: 'file', mode: current.mode & 0o777, sha256: hash.digest('hex') })
      } finally { await file.close() }
    } else {
      throw new Error('Update bundle contains an unsupported file type')
    }
    if (entries.length + pending.length > 100_000) throw new Error('Update bundle has too many entries')
  }
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return { format: 1, entries }
}

function inside(root: string, path: string): boolean {
  const suffix = relative(root, path)
  return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}
