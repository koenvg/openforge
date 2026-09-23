import { CrashSafeFilePersistence } from './crashSafeFilePersistence.js'
import type { RestartWindowWorkspace, RestartWorkspace } from './restartWorkspace.js'
import { parseRestartWorkspace } from './restartWorkspaceValidation.js'

/** One host owns the operation record. Completed windows are acknowledged atomically. */
export class RestartWorkspaceStore {
  private readonly persistence = new CrashSafeFilePersistence()

  constructor(private readonly path: string, private readonly installationId: string) {}

  capture(operationId: string, windows: RestartWindowWorkspace[]): Promise<void> {
    return this.persistence.runExclusive(() => this.persist({
      version: 1, installationId: this.installationId, operationId, windows, restoredWindowIds: [],
    }))
  }

  load(operationId: string): Promise<RestartWorkspace | null> {
    return this.persistence.runExclusive(() => this.read(operationId))
  }

  /** A replacement app cannot reuse acknowledgements from windows that died with its predecessor. */
  restartRestoration(operationId: string): Promise<void> {
    return this.persistence.runExclusive(async () => {
      const record = await this.read(operationId, true)
      if (!record) throw new Error('Missing restart workspace for restoration retry')
      if (record.restoredWindowIds.length) await this.persist({ ...record, restoredWindowIds: [] })
    })
  }

  allWindowsAcknowledged(operationId: string): Promise<boolean> {
    return this.persistence.runExclusive(async () => {
      const record = await this.read(operationId, true)
      return !!record && record.windows.every(window => record.restoredWindowIds.includes(window.windowId))
    })
  }

  completeWindow(operationId: string, windowId: string): Promise<void> {
    return this.persistence.runExclusive(async () => {
      const record = await this.read(operationId)
      if (!record) return
      if (!record.windows.some(window => window.windowId === windowId)) throw new Error('Unknown restart window')
      if (record.restoredWindowIds.includes(windowId)) return
      record.restoredWindowIds.push(windowId)
      await this.persist(record)
    })
  }

  private async read(operationId: string, includeAcknowledged = false): Promise<RestartWorkspace | null> {
    const content = await this.persistence.readUtf8IfExists(this.path)
    if (content === null) return null
    const record = parseRestartWorkspace(JSON.parse(content))
    if (record.installationId !== this.installationId || record.operationId !== operationId) return null
    if (!includeAcknowledged && record.windows.every(window => record.restoredWindowIds.includes(window.windowId))) return null
    return record
  }

  private persist(record: RestartWorkspace): Promise<void> {
    return this.persistence.writeUtf8Atomic(this.path, JSON.stringify(parseRestartWorkspace(record)))
  }
}
