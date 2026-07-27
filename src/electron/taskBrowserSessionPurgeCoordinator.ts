import type {
  TaskBrowserPartitionRegistration,
  TaskBrowserPartitionRegistry,
} from './taskBrowserPartitionRegistry.js'

export interface TaskBrowserSessionPurgeIntent {
  id: number
  scope: 'task' | 'plugin'
  ownerId: string
  createdAt: number
}

export interface TaskBrowserSessionPurgeBackend {
  listPending(): Promise<TaskBrowserSessionPurgeIntent[]>
  acknowledge(intentId: number): Promise<void>
}

export interface TaskBrowserSessionPurgeLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string, error?: unknown): void
}

export interface TaskBrowserSessionPurgeDrainReport {
  acknowledgedIntentIds: number[]
  pendingIntentIds: number[]
}

export interface TaskBrowserSessionPurgeCoordinatorOptions {
  backend: TaskBrowserSessionPurgeBackend
  registry: TaskBrowserPartitionRegistry
  beginPurge(intent: TaskBrowserSessionPurgeIntent): void | Promise<void>
  purgeSession(record: TaskBrowserPartitionRegistration): Promise<void>
  logger?: TaskBrowserSessionPurgeLogger
}

const DEFAULT_LOGGER: TaskBrowserSessionPurgeLogger = console

export class TaskBrowserSessionPurgeCoordinator {
  private drainInFlight: Promise<TaskBrowserSessionPurgeDrainReport> | null = null
  private drainRequested = false

  constructor(private readonly options: TaskBrowserSessionPurgeCoordinatorOptions) {}

  drain(): Promise<TaskBrowserSessionPurgeDrainReport> {
    this.drainRequested = true
    if (!this.drainInFlight) this.drainInFlight = this.runRequestedDrains()
    return this.drainInFlight
  }

  private async runRequestedDrains(): Promise<TaskBrowserSessionPurgeDrainReport> {
    const logger = this.options.logger ?? DEFAULT_LOGGER
    let report: TaskBrowserSessionPurgeDrainReport = { acknowledgedIntentIds: [], pendingIntentIds: [] }
    try {
      while (this.drainRequested) {
        this.drainRequested = false
        try {
          report = await this.runDrain()
        } catch (error) {
          logger.error('[task-browser-purge] Unexpected purge drain failure; cleanup remains pending', error)
          report = { acknowledgedIntentIds: [], pendingIntentIds: [] }
        }
      }
      return report
    } finally {
      this.drainInFlight = null
    }
  }

  private async runDrain(): Promise<TaskBrowserSessionPurgeDrainReport> {
    const logger = this.options.logger ?? DEFAULT_LOGGER
    let intents: TaskBrowserSessionPurgeIntent[]
    try {
      intents = await this.options.backend.listPending()
    } catch (error) {
      logger.error('[task-browser-purge] Failed to list pending Task Browser Session purge intents; cleanup remains pending', error)
      return { acknowledgedIntentIds: [], pendingIntentIds: [] }
    }

    const acknowledgedIntentIds: number[] = []
    const pendingIntentIds: number[] = []
    for (const intent of intents) {
      const completed = await this.drainIntent(intent, logger)
      if (completed) acknowledgedIntentIds.push(intent.id)
      else pendingIntentIds.push(intent.id)
    }
    return { acknowledgedIntentIds, pendingIntentIds }
  }

  private async drainIntent(
    intent: TaskBrowserSessionPurgeIntent,
    logger: TaskBrowserSessionPurgeLogger,
  ): Promise<boolean> {
    try {
      await this.options.beginPurge(intent)
    } catch (error) {
      logger.error(`[task-browser-purge] Failed to release live resources for purge intent ${intent.id}; cleanup remains pending`, error)
      return false
    }

    let records: TaskBrowserPartitionRegistration[]
    try {
      records = intent.scope === 'task'
        ? await this.options.registry.listByTask(intent.ownerId)
        : await this.options.registry.listByPlugin(intent.ownerId)
    } catch (error) {
      logger.error(`[task-browser-purge] Failed to read partitions for purge intent ${intent.id}; cleanup remains pending`, error)
      return false
    }

    let failed = false
    for (const record of records) {
      try {
        await this.options.purgeSession(record)
        await this.options.registry.remove(record.pluginId, record.taskId)
      } catch (error) {
        failed = true
        logger.error(
          `[task-browser-purge] Failed to clear ${record.partition} for purge intent ${intent.id}; cleanup remains pending`,
          error,
        )
      }
    }
    if (failed) return false

    try {
      await this.options.backend.acknowledge(intent.id)
      logger.info(`[task-browser-purge] Acknowledged Task Browser Session purge intent ${intent.id}`)
      return true
    } catch (error) {
      logger.error(`[task-browser-purge] Failed to acknowledge purge intent ${intent.id}; acknowledgement will retry`, error)
      return false
    }
  }
}

const DESTRUCTIVE_COMMANDS = new Set(['delete_task', 'delete_project', 'uninstall_plugin'])

export async function invokeWithTaskBrowserSessionPurgeDrain<T>(
  request: { command?: unknown; payload?: unknown },
  invoke: () => Promise<T>,
  drain: () => Promise<unknown>,
): Promise<T> {
  const result = await invoke()
  if (typeof request.command === 'string' && DESTRUCTIVE_COMMANDS.has(request.command)) {
    await drain()
  }
  return result
}
