import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { measureUpdateBundle, updateBundleImages, updateManifestId, type UpdateBundleManifest } from './updateBundleManifest.js'
import type { UpdateImages } from './appUpdateVerification.js'

export interface StagedUpdateBundle {
  readonly bundlePath: string
  readonly manifestSha256: string
  readonly manifest: UpdateBundleManifest
  readonly images: UpdateImages
}

/** Installation-private staging. Staging proves integrity, never permission to install. */
export class UpdateBundleStore {
  constructor(private readonly root: string) {}

  async stage(source: string): Promise<StagedUpdateBundle> {
    if (!isAbsolute(this.root)) throw new Error('Update staging root must be absolute')
    const canonicalSource = await realpath(source)
    const root = join(await realpath(dirname(this.root)), basename(this.root))
    const suffix = relative(canonicalSource, root)
    if (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)) {
      throw new Error('Update staging must be outside the source bundle')
    }
    const expected = await measureUpdateBundle(source)
    updateBundleImages(expected)
    try { await mkdir(root, { mode: 0o700 }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    await this.checkRoot(root)
    const temporary = join(root, `staging-${randomUUID()}`)
    const destination = join(root, `bundle-${randomUUID()}.app`)
    try {
      await cp(source, temporary, { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true })
      const actual = await measureUpdateBundle(temporary)
      if (updateManifestId(actual) !== updateManifestId(expected)) throw new Error('Update bundle changed during staging')
      await rename(temporary, destination)
      return Object.freeze({ bundlePath: destination, manifestSha256: updateManifestId(actual), manifest: actual, images: Object.freeze(updateBundleImages(actual)) })
    } catch (error) {
      await rm(temporary, { recursive: true, force: true })
      throw error
    }
  }

  /** Reopens a persisted authorization without trusting a caller-provided manifest. */
  async reopen(bundlePath: string, manifestSha256: string): Promise<StagedUpdateBundle> {
    const root = join(await realpath(dirname(this.root)), basename(this.root))
    if (dirname(bundlePath) !== root || !/^bundle-[a-f0-9-]+\.app$/.test(basename(bundlePath))) {
      throw new Error('Update bundle does not belong to this staging directory')
    }
    await this.checkRoot(root)
    const manifest = await measureUpdateBundle(bundlePath)
    if (updateManifestId(manifest) !== manifestSha256) throw new Error('Staged update bundle changed')
    return Object.freeze({ bundlePath, manifestSha256, manifest, images: Object.freeze(updateBundleImages(manifest)) })
  }

  async verify(staged: StagedUpdateBundle): Promise<void> {
    const root = join(await realpath(dirname(this.root)), basename(this.root))
    if (dirname(staged.bundlePath) !== root || !/^bundle-[a-f0-9-]+\.app$/.test(basename(staged.bundlePath))) {
      throw new Error('Update bundle does not belong to this staging directory')
    }
    await this.checkRoot(root)
    if (updateManifestId(staged.manifest) !== staged.manifestSha256) throw new Error('Staged update manifest changed')
    const actual = await measureUpdateBundle(staged.bundlePath)
    if (updateManifestId(actual) !== staged.manifestSha256) throw new Error('Staged update bundle changed')
    if (JSON.stringify(updateBundleImages(actual)) !== JSON.stringify(staged.images)) {
      throw new Error('Staged update executable identities changed')
    }
  }

  private async checkRoot(root: string): Promise<void> {
    const metadata = await lstat(root)
    if (!metadata.isDirectory() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o700) {
      throw new Error('Unsafe update staging directory')
    }
  }
}
