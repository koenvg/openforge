import { appendFile, mkdir, rename, rmdir, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export type DeveloperLogLevel = 'info' | 'warn' | 'error'

export interface DeveloperLogEntry {
  id: number
  timestamp: string
  level: DeveloperLogLevel
  message: string
}

export interface DeveloperLogSnapshot {
  entries: DeveloperLogEntry[]
  logFilePath: string
  totalEntries: number
}

export interface DeveloperLogStore {
  append(level: DeveloperLogLevel, message: string): DeveloperLogEntry
  getRecentLogs(limit?: number): DeveloperLogEntry[]
  getSnapshot(limit?: number): DeveloperLogSnapshot
  flush(): Promise<void>
}

export interface DeveloperLogStoreOptions {
  maxEntries?: number
  logFilePath?: string
  maxFileBytes?: number
  maxArchiveFiles?: number
  maxMessageChars?: number
  flushIntervalMs?: number
  maxPendingLines?: number
}

export interface DeveloperLogDelegate {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface DeveloperLogSink {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

const DEFAULT_UI_TAIL_LIMIT = 1000
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_ARCHIVE_FILES = 3
const DEFAULT_MAX_MESSAGE_CHARS = 8192
const DEFAULT_FLUSH_INTERVAL_MS = 250
const DEFAULT_MAX_PENDING_LINES = 10_000
const ROTATION_LOCK_STALE_MS = 30_000

function defaultDeveloperLogPath(): string {
  return join(homedir(), '.openforge', 'logs', 'openforge-desktop.log')
}

function formatLogPart(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatLogMessage(args: unknown[]): string {
  return args.map(formatLogPart).join(' ')
}

function formatLogFileLine(entry: DeveloperLogEntry): string {
  return `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.message}\n`
}

function truncateMessage(message: string, maxChars: number): string {
  if (message.length <= maxChars) return message
  return `${message.slice(0, maxChars)}... [truncated ${message.length - maxChars} chars]`
}

function boundedLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined) return fallback
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : fallback
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

interface DeveloperLogFileWriterOptions {
  logFilePath: string
  maxFileBytes: number
  maxArchiveFiles: number
}

function createDeveloperLogFileWriter(options: DeveloperLogFileWriterOptions): (lines: string[]) => Promise<void> {
  const { logFilePath, maxFileBytes, maxArchiveFiles } = options
  const rotationLockPath = `${logFilePath}.rotation-lock`
  let directoryReady: Promise<string | undefined> | null = null
  let fileBytes: number | null = null

  async function currentFileBytes(): Promise<number> {
    try {
      return (await stat(logFilePath)).size
    } catch {
      return 0
    }
  }

  async function acquireRotationLock(): Promise<boolean> {
    try {
      await mkdir(rotationLockPath)
      return true
    } catch {
      try {
        if (Date.now() - (await stat(rotationLockPath)).mtimeMs <= ROTATION_LOCK_STALE_MS) return false
        await rmdir(rotationLockPath)
        await mkdir(rotationLockPath)
        return true
      } catch {
        return false
      }
    }
  }

  async function rotateArchives(): Promise<void> {
    if (maxArchiveFiles === 0) {
      await unlink(logFilePath)
      return
    }
    for (let archive = maxArchiveFiles; archive >= 1; archive -= 1) {
      const source = archive === 1 ? logFilePath : `${logFilePath}.${archive - 1}`
      const destination = `${logFilePath}.${archive}`
      try {
        await rename(source, destination)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }

  async function rotateIfNeeded(batchBytes: number): Promise<number | null> {
    if (!await acquireRotationLock()) return null
    try {
      const size = await currentFileBytes()
      if (size === 0 || size + batchBytes <= maxFileBytes) return size
      await rotateArchives()
      return 0
    } finally {
      await rmdir(rotationLockPath).catch(() => undefined)
    }
  }

  async function writeLines(lines: string[]): Promise<void> {
    directoryReady ??= mkdir(dirname(logFilePath), { recursive: true })
    await directoryReady
    let size = fileBytes ?? await currentFileBytes()
    const batch = lines.join('')
    const batchBytes = Buffer.byteLength(batch)
    if (size > 0 && size + batchBytes > maxFileBytes) {
      size = await rotateIfNeeded(batchBytes) ?? size
    }
    await appendFile(logFilePath, batch, 'utf8')
    fileBytes = size + batchBytes
  }

  return async (lines) => {
    try {
      await writeLines(lines)
    } catch {
      directoryReady = null
      fileBytes = null
    }
  }
}

export function createDeveloperLogStore(options: DeveloperLogStoreOptions = {}): DeveloperLogStore {
  const maxEntries = boundedLimit(options.maxEntries, DEFAULT_UI_TAIL_LIMIT)
  const logFilePath = options.logFilePath ?? defaultDeveloperLogPath()
  const maxMessageChars = boundedLimit(options.maxMessageChars, DEFAULT_MAX_MESSAGE_CHARS)
  const flushIntervalMs = nonNegativeInteger(options.flushIntervalMs, DEFAULT_FLUSH_INTERVAL_MS)
  const maxPendingLines = boundedLimit(options.maxPendingLines, DEFAULT_MAX_PENDING_LINES)
  const writeLines = createDeveloperLogFileWriter({
    logFilePath,
    maxFileBytes: boundedLimit(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES),
    maxArchiveFiles: nonNegativeInteger(options.maxArchiveFiles, DEFAULT_MAX_ARCHIVE_FILES),
  })
  const recentEntries: DeveloperLogEntry[] = []
  let nextId = 1
  let pendingLines: string[] = []
  let droppedLines = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let writing: Promise<void> | null = null

  function takePendingLines(): string[] {
    const lines = pendingLines
    pendingLines = []
    if (droppedLines > 0) {
      lines.push(`[${new Date().toISOString()}] WARN [developer-logs] dropped ${droppedLines} developer log lines while the disk was busy\n`)
      droppedLines = 0
    }
    return lines
  }

  async function drainPendingLines(): Promise<void> {
    while (pendingLines.length > 0 || droppedLines > 0) {
      await writeLines(takePendingLines())
    }
  }

  function flush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    writing ??= drainPendingLines().finally(() => { writing = null })
    return writing
  }

  function scheduleFlush(): void {
    if (flushTimer) return
    flushTimer = setTimeout(() => void flush(), flushIntervalMs)
    flushTimer.unref?.()
  }

  function getRecentLogs(limit?: number): DeveloperLogEntry[] {
    const count = Math.min(boundedLimit(limit, maxEntries), maxEntries, nextId - 1)
    const firstId = nextId - count
    return Array.from({ length: count }, (_, offset) => recentEntries[(firstId + offset - 1) % maxEntries])
  }

  return {
    append(level: DeveloperLogLevel, message: string): DeveloperLogEntry {
      const entry = {
        id: nextId,
        timestamp: new Date().toISOString(),
        level,
        message: truncateMessage(message, maxMessageChars),
      }
      recentEntries[(entry.id - 1) % maxEntries] = entry
      nextId += 1
      if (pendingLines.length < maxPendingLines) pendingLines.push(formatLogFileLine(entry))
      else droppedLines += 1
      scheduleFlush()
      return entry
    },

    getRecentLogs,

    getSnapshot(limit?: number): DeveloperLogSnapshot {
      return {
        entries: getRecentLogs(limit),
        logFilePath,
        totalEntries: nextId - 1,
      }
    },

    flush,
  }
}

export function createDeveloperLogSink(
  store: DeveloperLogStore,
  delegate: DeveloperLogDelegate = console,
): DeveloperLogSink {
  function write(level: DeveloperLogLevel, args: unknown[]): void {
    delegate[level](...args)
    store.append(level, formatLogMessage(args))
  }

  return {
    info(message: string, ...args: unknown[]): void {
      write('info', [message, ...args])
    },
    warn(message: string, ...args: unknown[]): void {
      write('warn', [message, ...args])
    },
    error(message: string, ...args: unknown[]): void {
      write('error', [message, ...args])
    },
  }
}

export const developerLogStore = createDeveloperLogStore()
export const developerLogSink = createDeveloperLogSink(developerLogStore)
