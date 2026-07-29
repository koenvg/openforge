import { CrashSafeFilePersistence } from './crashSafeFilePersistence.js'
import type { TaskBrowserSessionPartition } from './taskBrowserSurfaceManager.js'

export interface TaskBrowserPartitionRegistration {
  pluginId: string
  taskId: string
  partition: TaskBrowserSessionPartition
}

export interface TaskBrowserPartitionRegistry {
  register(record: TaskBrowserPartitionRegistration): Promise<void>
  listByTask(taskId: string): Promise<TaskBrowserPartitionRegistration[]>
  listByPlugin(pluginId: string): Promise<TaskBrowserPartitionRegistration[]>
  remove(pluginId: string, taskId: string): Promise<void>
}

export interface TaskBrowserPartitionRegistryLogger {
  warn(message: string): void
  error(message: string, error?: unknown): void
}

export interface FileTaskBrowserPartitionRegistryOptions {
  logger?: TaskBrowserPartitionRegistryLogger
}

type RegistryFile = {
  version: 1
  generation?: number
  partitions: TaskBrowserPartitionRegistration[]
}

type RegistrySnapshot = {
  generation: number
  records: Map<string, TaskBrowserPartitionRegistration>
}

type RegistryCandidate =
  | { status: 'missing' }
  | { status: 'invalid'; error: Error }
  | { status: 'valid'; content: string; snapshot: RegistrySnapshot }

const PARTITION_PATTERN = /^persist:openforge-task-browser-[a-f0-9]{64}$/
const INITIALIZATION_MARKER = 'openforge-task-browser-partition-registry-v1\n'
const DEFAULT_LOGGER: TaskBrowserPartitionRegistryLogger = console

function key(pluginId: string, taskId: string): string {
  return `${pluginId}\u0000${taskId}`
}

function copy(record: TaskBrowserPartitionRegistration): TaskBrowserPartitionRegistration {
  return { ...record }
}

function parseRegistry(content: string, path: string): RegistrySnapshot {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch (error) {
    throw new Error(`Task Browser partition registry at ${path} is not valid JSON`, { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Task Browser partition registry at ${path} has an invalid root value`)
  }
  const file = value as Partial<RegistryFile>
  if (file.version !== 1 || !Array.isArray(file.partitions)) {
    throw new Error(`Task Browser partition registry at ${path} has an unsupported format`)
  }
  if (file.generation !== undefined && (!Number.isSafeInteger(file.generation) || file.generation < 0)) {
    throw new Error(`Task Browser partition registry at ${path} has an invalid generation`)
  }

  const records = new Map<string, TaskBrowserPartitionRegistration>()
  for (const candidate of file.partitions) {
    if (
      typeof candidate !== 'object'
      || candidate === null
      || typeof candidate.pluginId !== 'string'
      || candidate.pluginId.trim() === ''
      || typeof candidate.taskId !== 'string'
      || candidate.taskId.trim() === ''
      || typeof candidate.partition !== 'string'
      || !PARTITION_PATTERN.test(candidate.partition)
    ) {
      throw new Error(`Task Browser partition registry at ${path} contains an invalid registration`)
    }
    const record = candidate as TaskBrowserPartitionRegistration
    const recordKey = key(record.pluginId, record.taskId)
    const existing = records.get(recordKey)
    if (existing && existing.partition !== record.partition) {
      throw new Error(`Task Browser partition registry at ${path} contains conflicting registrations`)
    }
    records.set(recordKey, copy(record))
  }
  return { generation: file.generation ?? 0, records }
}

function snapshotsHaveSameRecords(left: RegistrySnapshot, right: RegistrySnapshot): boolean {
  if (left.records.size !== right.records.size) return false
  for (const [recordKey, record] of left.records) {
    const other = right.records.get(recordKey)
    if (!other || other.partition !== record.partition) return false
  }
  return true
}

function serializeRegistry(snapshot: RegistrySnapshot): string {
  const file: RegistryFile = {
    version: 1,
    generation: snapshot.generation,
    partitions: [...snapshot.records.values()].map(copy),
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

function recoveryFailure(
  path: string,
  backupPath: string,
  primary: RegistryCandidate,
  backup: RegistryCandidate,
  reason = 'there is no valid primary or backup',
): Error {
  const causes = [primary, backup]
    .filter((candidate): candidate is Extract<RegistryCandidate, { status: 'invalid' }> => candidate.status === 'invalid')
    .map(candidate => candidate.error)
  return new Error(
    `Task Browser partition registry recovery failed because ${reason}. Cleanup remains pending. `
    + `Restore a trusted valid registry at ${path} or ${backupPath}. `
    + `If no trustworthy registry exists, manually clear all Task Browser session data before removing both registry copies and the initialization marker at ${path}.initialized, then restart OpenForge.`,
    causes.length > 0 ? { cause: new AggregateError(causes) } : undefined,
  )
}

export class FileTaskBrowserPartitionRegistry implements TaskBrowserPartitionRegistry {
  private snapshot: RegistrySnapshot | null = null
  private readonly persistence = new CrashSafeFilePersistence()

  constructor(
    private readonly pathSource: string | (() => string),
    private readonly options: FileTaskBrowserPartitionRegistryOptions = {},
  ) {}

  register(record: TaskBrowserPartitionRegistration): Promise<void> {
    return this.persistence.runExclusive(async () => {
      this.validateRegistration(record)
      const snapshot = await this.load()
      const recordKey = key(record.pluginId, record.taskId)
      const existing = snapshot.records.get(recordKey)
      if (existing) {
        if (existing.partition !== record.partition) {
          throw new Error(`Task Browser partition registry already maps ${record.pluginId}/${record.taskId} to another partition`)
        }
        return
      }
      const records = new Map(snapshot.records)
      records.set(recordKey, copy(record))
      await this.persist(this.nextSnapshot(snapshot, records))
    })
  }

  listByTask(taskId: string): Promise<TaskBrowserPartitionRegistration[]> {
    return this.persistence.runExclusive(async () => {
      const snapshot = await this.load()
      return [...snapshot.records.values()].filter(record => record.taskId === taskId).map(copy)
    })
  }

  listByPlugin(pluginId: string): Promise<TaskBrowserPartitionRegistration[]> {
    return this.persistence.runExclusive(async () => {
      const snapshot = await this.load()
      return [...snapshot.records.values()].filter(record => record.pluginId === pluginId).map(copy)
    })
  }

  remove(pluginId: string, taskId: string): Promise<void> {
    return this.persistence.runExclusive(async () => {
      const snapshot = await this.load()
      const records = new Map(snapshot.records)
      if (!records.delete(key(pluginId, taskId))) return
      await this.persist(this.nextSnapshot(snapshot, records))
    })
  }

  private path(): string {
    return typeof this.pathSource === 'string' ? this.pathSource : this.pathSource()
  }

  private backupPath(path: string): string {
    return `${path}.backup`
  }

  private initializationMarkerPath(path: string): string {
    return `${path}.initialized`
  }

  private async load(): Promise<RegistrySnapshot> {
    if (this.snapshot) return this.snapshot
    const path = this.path()
    const backupPath = this.backupPath(path)
    const markerPath = this.initializationMarkerPath(path)
    const [primary, backup, initialized] = await Promise.all([
      this.readCandidate(path),
      this.readCandidate(backupPath),
      this.hasInitializationMarker(markerPath),
    ])

    if (primary.status === 'missing' && backup.status === 'missing') {
      if (initialized) {
        throw recoveryFailure(
          path,
          backupPath,
          primary,
          backup,
          'both registry copies are missing after initialization',
        )
      }
      this.snapshot = { generation: 0, records: new Map() }
      return this.snapshot
    }

    const markerSynchronized = initialized || await this.repairCopy(
      markerPath,
      INITIALIZATION_MARKER,
      null,
      `Failed to persist the Task Browser partition registry initialization marker at ${markerPath}; marker creation will retry`,
    )

    if (primary.status === 'valid' && backup.status === 'valid') {
      return this.reconcileValidCopies(path, backupPath, primary, backup, markerSynchronized)
    }

    if (primary.status === 'valid') {
      const warning = backup.status === 'invalid'
        ? `[task-browser-partition-registry] Repaired corrupt backup registry at ${backupPath} from valid primary at ${path}`
        : null
      const synchronized = await this.repairCopy(
        backupPath,
        primary.content,
        warning,
        `Failed to synchronize the Task Browser partition registry backup at ${backupPath}; the valid primary at ${path} remains in use and repair will retry`,
      )
      if (synchronized && markerSynchronized) this.snapshot = primary.snapshot
      return primary.snapshot
    }

    if (backup.status === 'valid') {
      const warning = primary.status === 'invalid'
        ? `[task-browser-partition-registry] Recovered corrupt primary registry at ${path} from backup at ${backupPath}`
        : `[task-browser-partition-registry] Restored missing primary registry at ${path} from backup at ${backupPath}`
      const synchronized = await this.repairCopy(
        path,
        backup.content,
        warning,
        `Failed to restore the Task Browser partition registry primary at ${path}; the valid backup at ${backupPath} remains in use and repair will retry`,
      )
      if (synchronized && markerSynchronized) this.snapshot = backup.snapshot
      return backup.snapshot
    }

    throw recoveryFailure(path, backupPath, primary, backup)
  }

  private async reconcileValidCopies(
    path: string,
    backupPath: string,
    primary: Extract<RegistryCandidate, { status: 'valid' }>,
    backup: Extract<RegistryCandidate, { status: 'valid' }>,
    markerSynchronized: boolean,
  ): Promise<RegistrySnapshot> {
    if (primary.snapshot.generation === backup.snapshot.generation) {
      if (!snapshotsHaveSameRecords(primary.snapshot, backup.snapshot)) {
        throw recoveryFailure(
          path,
          backupPath,
          primary,
          backup,
          `the primary and backup contain conflicting registrations at generation ${primary.snapshot.generation}`,
        )
      }
      if (primary.content === backup.content) {
        if (markerSynchronized) this.snapshot = primary.snapshot
        return primary.snapshot
      }
      const synchronized = await this.repairCopy(
        backupPath,
        primary.content,
        null,
        `Failed to synchronize equivalent Task Browser partition registry copies at ${path} and ${backupPath}; the valid primary remains in use and repair will retry`,
      )
      if (synchronized && markerSynchronized) this.snapshot = primary.snapshot
      return primary.snapshot
    }

    const backupIsNewer = backup.snapshot.generation > primary.snapshot.generation
    const source = backupIsNewer ? backup : primary
    const targetPath = backupIsNewer ? path : backupPath
    const warning = backupIsNewer
      ? `[task-browser-partition-registry] Recovered stale primary registry at ${path} from newer backup at ${backupPath}`
      : `[task-browser-partition-registry] Repaired stale backup registry at ${backupPath} from newer primary at ${path}`
    const synchronized = await this.repairCopy(
      targetPath,
      source.content,
      warning,
      `Failed to synchronize Task Browser partition registry generations at ${path} and ${backupPath}; the newer valid copy remains in use and repair will retry`,
    )
    if (synchronized && markerSynchronized) this.snapshot = source.snapshot
    return source.snapshot
  }

  private async hasInitializationMarker(path: string): Promise<boolean> {
    try {
      return await this.persistence.readUtf8IfExists(path) !== null
    } catch (error) {
      throw new Error(`Failed to read Task Browser partition registry initialization marker at ${path}`, { cause: error })
    }
  }
  private async readCandidate(path: string): Promise<RegistryCandidate> {
    let content: string | null
    try {
      content = await this.persistence.readUtf8IfExists(path)
    } catch (error) {
      throw new Error(`Failed to read Task Browser partition registry at ${path}`, { cause: error })
    }
    if (content === null) return { status: 'missing' }
    try {
      return { status: 'valid', content, snapshot: parseRegistry(content, path) }
    } catch (error) {
      return { status: 'invalid', error: error as Error }
    }
  }

  private async repairCopy(
    targetPath: string,
    content: string,
    warning: string | null,
    failureMessage: string,
  ): Promise<boolean> {
    try {
      await this.persistence.writeUtf8Atomic(targetPath, content)
      if (warning) (this.options.logger ?? DEFAULT_LOGGER).warn(warning)
      return true
    } catch (error) {
      ;(this.options.logger ?? DEFAULT_LOGGER).error(
        `[task-browser-partition-registry] ${failureMessage}`,
        error,
      )
      return false
    }
  }

  private nextSnapshot(
    current: RegistrySnapshot,
    records: Map<string, TaskBrowserPartitionRegistration>,
  ): RegistrySnapshot {
    const generation = current.generation + 1
    if (!Number.isSafeInteger(generation)) {
      throw new Error('Task Browser partition registry generation is exhausted; cleanup remains pending')
    }
    return { generation, records }
  }

  private async persist(snapshot: RegistrySnapshot): Promise<void> {
    const path = this.path()
    const backupPath = this.backupPath(path)
    const markerPath = this.initializationMarkerPath(path)
    const content = serializeRegistry(snapshot)
    try {
      // The backup is committed first. If the process exits between renames, its higher
      // generation is authoritative and repairs the stale primary on the next load.
      await this.persistence.writeUtf8Atomic(backupPath, content)
      await this.persistence.writeUtf8Atomic(path, content)
      await this.persistence.writeUtf8Atomic(markerPath, INITIALIZATION_MARKER)
      this.snapshot = snapshot
    } catch (error) {
      throw new Error(
        `Failed to persist synchronized Task Browser partition registry copies at ${path} and ${backupPath}`,
        { cause: error },
      )
    }
  }


  private validateRegistration(record: TaskBrowserPartitionRegistration): void {
    if (!record.pluginId.trim() || !record.taskId.trim() || !PARTITION_PATTERN.test(record.partition)) {
      throw new Error('Task Browser partition registry requires a valid plugin, Task, and persistent partition')
    }
  }

}
