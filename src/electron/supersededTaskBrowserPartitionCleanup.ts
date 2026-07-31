import type {
  TaskBrowserPartitionRegistration,
  TaskBrowserPartitionRegistry,
} from './taskBrowserPartitionRegistry.js'
import { isSupersededTaskBrowserPartition } from './taskBrowserSurfacePolicy.js'

export interface SupersededTaskBrowserPartitionCleanupLogger {
  info(message: string): void
  error(message: string, error?: unknown): void
}

export interface SupersededTaskBrowserPartitionCleanupOptions {
  registry: Pick<TaskBrowserPartitionRegistry, 'listAll' | 'remove'>
  clearSession(record: TaskBrowserPartitionRegistration): Promise<void>
  logger?: SupersededTaskBrowserPartitionCleanupLogger
}

export interface SupersededTaskBrowserPartitionCleanupReport {
  purgedPartitions: string[]
  pendingPartitions: string[]
}

const DEFAULT_LOGGER: SupersededTaskBrowserPartitionCleanupLogger = console

/**
 * Clears the per-Task partitions written before ADR 0012. No surface can bind to one and no session
 * reset can reach one, so leaving them would strand real credentials on disk. A partition that fails
 * to clear stays registered, and the next launch retries it idempotently.
 */
export async function purgeSupersededTaskBrowserPartitions(
  options: SupersededTaskBrowserPartitionCleanupOptions,
): Promise<SupersededTaskBrowserPartitionCleanupReport> {
  const logger = options.logger ?? DEFAULT_LOGGER
  let records
  try {
    records = await options.registry.listAll()
  } catch (error) {
    logger.error(
      '[task-browser-partition-cleanup] Failed to read the partition registry; cleanup remains pending',
      error,
    )
    return { purgedPartitions: [], pendingPartitions: [] }
  }

  const superseded = records.filter(record => isSupersededTaskBrowserPartition(record.partition))
  if (superseded.length === 0) return { purgedPartitions: [], pendingPartitions: [] }

  const purgedPartitions: string[] = []
  const pendingPartitions: string[] = []
  for (const record of superseded) {
    try {
      await options.clearSession(record)
      await options.registry.remove(record.partition)
      purgedPartitions.push(record.partition)
    } catch (error) {
      pendingPartitions.push(record.partition)
      logger.error(
        `[task-browser-partition-cleanup] Failed to clear superseded partition for plugin ${record.pluginId}; cleanup remains pending`,
        error,
      )
    }
  }

  if (purgedPartitions.length > 0) {
    logger.info(
      `[task-browser-partition-cleanup] Cleared ${purgedPartitions.length} superseded per-Task browser session(s); affected plugins require signing in again`,
    )
  }
  return { purgedPartitions, pendingPartitions }
}
