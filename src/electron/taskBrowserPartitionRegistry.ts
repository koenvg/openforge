import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

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

type RegistryFile = {
  version: 1
  partitions: TaskBrowserPartitionRegistration[]
}

const PARTITION_PATTERN = /^persist:openforge-task-browser-[a-f0-9]{64}$/

function key(pluginId: string, taskId: string): string {
  return `${pluginId}\u0000${taskId}`
}

function copy(record: TaskBrowserPartitionRegistration): TaskBrowserPartitionRegistration {
  return { ...record }
}

function parseRegistry(content: string, path: string): Map<string, TaskBrowserPartitionRegistration> {
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
  return records
}

export class FileTaskBrowserPartitionRegistry implements TaskBrowserPartitionRegistry {
  private records: Map<string, TaskBrowserPartitionRegistration> | null = null
  private operation: Promise<void> = Promise.resolve()

  constructor(private readonly pathSource: string | (() => string)) {}

  register(record: TaskBrowserPartitionRegistration): Promise<void> {
    return this.exclusive(async () => {
      this.validateRegistration(record)
      const records = await this.load()
      const recordKey = key(record.pluginId, record.taskId)
      const existing = records.get(recordKey)
      if (existing) {
        if (existing.partition !== record.partition) {
          throw new Error(`Task Browser partition registry already maps ${record.pluginId}/${record.taskId} to another partition`)
        }
        return
      }
      const next = new Map(records)
      next.set(recordKey, copy(record))
      await this.persist(next)
      this.records = next
    })
  }

  listByTask(taskId: string): Promise<TaskBrowserPartitionRegistration[]> {
    return this.exclusive(async () => {
      const records = await this.load()
      return [...records.values()].filter(record => record.taskId === taskId).map(copy)
    })
  }

  listByPlugin(pluginId: string): Promise<TaskBrowserPartitionRegistration[]> {
    return this.exclusive(async () => {
      const records = await this.load()
      return [...records.values()].filter(record => record.pluginId === pluginId).map(copy)
    })
  }

  remove(pluginId: string, taskId: string): Promise<void> {
    return this.exclusive(async () => {
      const records = await this.load()
      const next = new Map(records)
      if (!next.delete(key(pluginId, taskId))) return
      await this.persist(next)
      this.records = next
    })
  }

  private path(): string {
    return typeof this.pathSource === 'string' ? this.pathSource : this.pathSource()
  }

  private async load(): Promise<Map<string, TaskBrowserPartitionRegistration>> {
    if (this.records) return this.records
    const path = this.path()
    let content: string
    try {
      content = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.records = new Map()
        return this.records
      }
      throw new Error(`Failed to read Task Browser partition registry at ${path}`, { cause: error })
    }
    this.records = parseRegistry(content, path)
    return this.records
  }

  private async persist(records: Map<string, TaskBrowserPartitionRegistration>): Promise<void> {
    const path = this.path()
    const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`
    const file: RegistryFile = { version: 1, partitions: [...records.values()].map(copy) }
    await mkdir(dirname(path), { recursive: true })
    let temporaryFile: Awaited<ReturnType<typeof open>> | null = null
    try {
      temporaryFile = await open(temporaryPath, 'w', 0o600)
      await temporaryFile.writeFile(`${JSON.stringify(file, null, 2)}\n`, 'utf8')
      await temporaryFile.sync()
      await temporaryFile.close()
      temporaryFile = null
      await rename(temporaryPath, path)

      const registryDirectory = await open(dirname(path), 'r')
      try {
        await registryDirectory.sync()
      } finally {
        await registryDirectory.close()
      }
    } catch (error) {
      await temporaryFile?.close().catch(() => undefined)
      await unlink(temporaryPath).catch(() => undefined)
      throw new Error(`Failed to persist Task Browser partition registry at ${path}`, { cause: error })
    }
  }

  private validateRegistration(record: TaskBrowserPartitionRegistration): void {
    if (!record.pluginId.trim() || !record.taskId.trim() || !PARTITION_PATTERN.test(record.partition)) {
      throw new Error('Task Browser partition registry requires a valid plugin, Task, and persistent partition')
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation)
    this.operation = result.then(() => undefined, () => undefined)
    return result
  }
}
