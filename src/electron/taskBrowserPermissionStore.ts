import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

import { isTaskBrowserPermissionDescriptor } from './taskBrowserPermissionPolicy.js'
import type {
  TaskBrowserPermissionDecisionRecord,
  TaskBrowserPermissionStore,
} from './taskBrowserPermissionPolicy.js'

type PermissionFile = {
  version: 1
  decisions: TaskBrowserPermissionDecisionRecord[]
}

function normalizedOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value
  } catch {
    return false
  }
}

function copyRecord(record: TaskBrowserPermissionDecisionRecord): TaskBrowserPermissionDecisionRecord {
  return {
    ...record,
    descriptor: record.descriptor.permission === 'media'
      ? { permission: 'media', mediaTypes: [...record.descriptor.mediaTypes] }
      : { ...record.descriptor },
  }
}

function recordKey(record: TaskBrowserPermissionDecisionRecord): string {
  return JSON.stringify([record.pluginId, record.taskId, record.origin, record.descriptor])
}

function validateRecord(value: unknown, path: string): TaskBrowserPermissionDecisionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Task Browser permission store at ${path} contains an invalid decision`)
  }
  const candidate = value as Partial<TaskBrowserPermissionDecisionRecord>
  if (
    typeof candidate.pluginId !== 'string'
    || !candidate.pluginId.trim()
    || typeof candidate.taskId !== 'string'
    || !candidate.taskId.trim()
    || typeof candidate.origin !== 'string'
    || !normalizedOrigin(candidate.origin)
    || !isTaskBrowserPermissionDescriptor(candidate.descriptor)
    || (candidate.decision !== 'allow' && candidate.decision !== 'block')
  ) {
    throw new Error(`Task Browser permission store at ${path} contains an invalid decision`)
  }
  return copyRecord(candidate as TaskBrowserPermissionDecisionRecord)
}

function parsePermissionFile(content: string, path: string): TaskBrowserPermissionDecisionRecord[] {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch (error) {
    throw new Error(`Task Browser permission store at ${path} is not valid JSON`, { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Task Browser permission store at ${path} has an invalid root value`)
  }
  const file = value as Partial<PermissionFile>
  if (file.version !== 1 || !Array.isArray(file.decisions)) {
    throw new Error(`Task Browser permission store at ${path} has an unsupported format`)
  }

  const decisions = new Map<string, TaskBrowserPermissionDecisionRecord>()
  for (const value of file.decisions) {
    const record = validateRecord(value, path)
    const key = recordKey(record)
    const existing = decisions.get(key)
    if (existing && existing.decision !== record.decision) {
      throw new Error(`Task Browser permission store at ${path} contains conflicting decisions`)
    }
    decisions.set(key, record)
  }
  return [...decisions.values()]
}

export class FileTaskBrowserPermissionStore implements TaskBrowserPermissionStore {
  private records: TaskBrowserPermissionDecisionRecord[] | null = null
  private operation: Promise<void> = Promise.resolve()

  constructor(private readonly pathSource: string | (() => string)) {}

  load(): Promise<TaskBrowserPermissionDecisionRecord[]> {
    return this.exclusive(async () => (await this.loadInternal()).map(copyRecord))
  }

  replace(records: TaskBrowserPermissionDecisionRecord[]): Promise<void> {
    return this.exclusive(async () => {
      await this.loadInternal()
      const next = records.map(record => validateRecord(record, this.path()))
      const unique = new Map(next.map(record => [recordKey(record), record]))
      if (unique.size !== next.length) {
        throw new Error('Task Browser permission store cannot persist duplicate decisions')
      }
      const durable = [...unique.values()].map(copyRecord)
      await this.persist(durable)
      this.records = durable
    })
  }

  private path(): string {
    return typeof this.pathSource === 'string' ? this.pathSource : this.pathSource()
  }

  private async loadInternal(): Promise<TaskBrowserPermissionDecisionRecord[]> {
    if (this.records) return this.records
    const path = this.path()
    let content: string
    try {
      content = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.records = []
        return this.records
      }
      throw new Error(`Failed to read Task Browser permission store at ${path}`, { cause: error })
    }
    this.records = parsePermissionFile(content, path)
    return this.records
  }

  private async persist(records: TaskBrowserPermissionDecisionRecord[]): Promise<void> {
    const path = this.path()
    const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`
    const file: PermissionFile = { version: 1, decisions: records.map(copyRecord) }
    await mkdir(dirname(path), { recursive: true })
    let temporaryFile: Awaited<ReturnType<typeof open>> | null = null
    try {
      temporaryFile = await open(temporaryPath, 'w', 0o600)
      await temporaryFile.writeFile(`${JSON.stringify(file, null, 2)}\n`, 'utf8')
      await temporaryFile.sync()
      await temporaryFile.close()
      temporaryFile = null
      await rename(temporaryPath, path)

      const directory = await open(dirname(path), 'r')
      try {
        await directory.sync()
      } finally {
        await directory.close()
      }
    } catch (error) {
      await temporaryFile?.close().catch(() => undefined)
      await unlink(temporaryPath).catch(() => undefined)
      throw new Error(`Failed to persist Task Browser permission store at ${path}`, { cause: error })
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation)
    this.operation = result.then(() => undefined, () => undefined)
    return result
  }
}
