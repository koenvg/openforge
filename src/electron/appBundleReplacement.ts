import { lstat, mkdir, open, realpath, rename, rmdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { CrashSafeFilePersistence } from './crashSafeFilePersistence.js'

interface ReplacementRecord {
  version: 1
  operationId: string
  installed: string
  staged: string
  backup: string
  phase: 'prepared' | 'old-retained' | 'installed' | 'launching' | 'awaiting-readiness' | 'recovery' | 'restored'
}

export interface AppReplacementPaths {
  installed: string
  staged: string
  stateRoot: string
  operationId: string
}

/** Supplied only by a verified helper after authenticating the installation handoff. */
export interface AppReplacementAuthority {
  verify(bundle: string): Promise<void>
  waitForExit(): Promise<void>
  launch(bundle: string, operationId: string): Promise<void>
}

export class AppBundleReplacement {
  private readonly persistence = new CrashSafeFilePersistence()
  private readonly paths: AppReplacementPaths
  constructor(paths: AppReplacementPaths) {
    if (!/^[A-Za-z0-9-]{1,128}$/.test(paths.operationId)) throw new Error('Invalid replacement operation identity')
    const locations = [paths.installed, paths.staged, paths.stateRoot]
    if (locations.some(path => !isAbsolute(path) || resolve(path) !== path)) throw new Error('Replacement paths must be absolute and normalized')
    for (const [parentIndex, parent] of locations.entries()) {
      for (const [childIndex, child] of locations.entries()) {
        if (parentIndex === childIndex) continue
        const suffix = relative(parent, child)
        if (!suffix || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))) {
          throw new Error('Replacement paths must be distinct and outside each other')
        }
      }
    }
    this.paths = { ...paths }
  }

  private get recordPath() { return join(this.paths.stateRoot, 'app-replacement.json') }

  async run(authority: AppReplacementAuthority): Promise<void> {
    const lock = join(await realpath(dirname(this.paths.installed)), `.${basename(this.paths.installed)}.update-lock`)
    try { await mkdir(lock, { mode: 0o700 }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('App replacement is already owned; explicit recovery may be required')
      throw error
    }
    try {
      if (await this.status()) throw new Error('App replacement already recorded; resolve the previous operation before retrying')
      await this.replace(authority)
    } finally { await rmdir(lock) }
  }

  private async replace(authority: AppReplacementAuthority): Promise<void> {
    for (const path of [this.paths.installed, this.paths.staged]) {
      if (!(await lstat(path)).isDirectory()) throw new Error('Replacement requires a real bundle directory, not a symlink')
    }
    await authority.verify(this.paths.staged)
    await authority.waitForExit()
    const record: ReplacementRecord = {
      version: 1, operationId: this.paths.operationId, installed: this.paths.installed, staged: this.paths.staged,
      backup: `${this.paths.installed}.retained-${this.paths.operationId}`, phase: 'prepared',
    }
    for (const path of [record.backup, `${record.staged}.failed-${record.operationId}`]) {
      try {
        await lstat(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      throw new Error('Replacement recovery path already exists; refusing to overwrite it')
    }
    let retained = false
    let installed = false
    let launchAttempted = false
    try {
      await this.persist(record)
      await rename(record.installed, record.backup)
      retained = true
      await this.syncBundleParents()
      await this.persist({ ...record, phase: 'old-retained' })
      await rename(record.staged, record.installed)
      installed = true
      await this.syncBundleParents()
      await this.persist({ ...record, phase: 'installed' })
      await authority.verify(record.installed)
      await this.persist({ ...record, phase: 'launching' })
      launchAttempted = true
      await authority.launch(record.installed, record.operationId)
      await this.persist({ ...record, phase: 'awaiting-readiness' })
    } catch (error) {
      if (!launchAttempted && retained) {
        try {
          if (installed) await rename(record.installed, `${record.staged}.failed-${record.operationId}`)
          await rename(record.backup, record.installed)
          await this.syncBundleParents()
          await this.persist({ ...record, phase: 'restored' })
        } catch (restoreError) {
          await this.persist({ ...record, phase: 'recovery' })
          throw new AggregateError([error, restoreError], 'App replacement and restoration failed; explicit recovery required')
        }
      } else if (launchAttempted) {
        // A failed launch acknowledgement does not prove the new Sidecar never ran.
        await this.persist({ ...record, phase: 'recovery' })
      }
      throw error
    }
  }

  async status(): Promise<ReplacementRecord | null> {
    const content = await this.persistence.readUtf8IfExists(this.recordPath)
    if (content === null) return null
    const record = JSON.parse(content) as Partial<ReplacementRecord> | null
    if (!record || record.version !== 1 || record.operationId !== this.paths.operationId
      || record.installed !== this.paths.installed || record.staged !== this.paths.staged
      || record.backup !== `${this.paths.installed}.retained-${this.paths.operationId}`
      || !['prepared', 'old-retained', 'installed', 'launching', 'awaiting-readiness', 'recovery', 'restored'].includes(record.phase ?? '')) {
      throw new Error('Invalid replacement record; explicit recovery required')
    }
    return record as ReplacementRecord
  }

  private async syncBundleParents(): Promise<void> {
    for (const path of new Set([dirname(this.paths.installed), dirname(this.paths.staged)])) {
      const directory = await open(path, 'r')
      try { await directory.sync() } finally { await directory.close() }
    }
  }

  private persist(record: ReplacementRecord): Promise<void> {
    return this.persistence.writeUtf8Atomic(this.recordPath, JSON.stringify(record))
  }
}
