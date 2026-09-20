import { appendFileSync, existsSync, mkdirSync, renameSync, rmdirSync, statSync, unlinkSync } from 'node:fs'
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
}

export interface DeveloperLogStoreOptions {
  maxEntries?: number
  logFilePath?: string
  maxFileBytes?: number
  maxArchiveFiles?: number
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

function boundedLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined) return fallback
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : fallback
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

export function createDeveloperLogStore(options: DeveloperLogStoreOptions = {}): DeveloperLogStore {
  const maxEntries = boundedLimit(options.maxEntries, DEFAULT_UI_TAIL_LIMIT)
  const logFilePath = options.logFilePath ?? defaultDeveloperLogPath()
  const maxFileBytes = boundedLimit(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES)
  const maxArchiveFiles = nonNegativeInteger(options.maxArchiveFiles, DEFAULT_MAX_ARCHIVE_FILES)
  const rotationLockPath = `${logFilePath}.rotation-lock`
  const entries: DeveloperLogEntry[] = []
  let nextId = 1

  function acquireRotationLock(): boolean {
    try {
      mkdirSync(rotationLockPath)
      return true
    } catch {
      try {
        if (Date.now() - statSync(rotationLockPath).mtimeMs <= ROTATION_LOCK_STALE_MS) return false
        rmdirSync(rotationLockPath)
        mkdirSync(rotationLockPath)
        return true
      } catch {
        return false
      }
    }
  }

  function rotateIfNeeded(line: string): void {
    if (!acquireRotationLock()) return
    try {
      if (existsSync(logFilePath) && statSync(logFilePath).size + Buffer.byteLength(line) > maxFileBytes) {
        if (maxArchiveFiles === 0) {
          unlinkSync(logFilePath)
        } else {
          for (let archive = maxArchiveFiles; archive >= 1; archive -= 1) {
            const source = archive === 1 ? logFilePath : `${logFilePath}.${archive - 1}`
            const destination = `${logFilePath}.${archive}`
            if (!existsSync(source)) continue
            if (existsSync(destination)) unlinkSync(destination)
            renameSync(source, destination)
          }
        }
      }
    } finally {
      try {
        rmdirSync(rotationLockPath)
      } catch {
        return
      }
    }
  }

  function appendToFileBestEffort(entry: DeveloperLogEntry): void {
    try {
      mkdirSync(dirname(logFilePath), { recursive: true })
      const line = formatLogFileLine(entry)
      rotateIfNeeded(line)
      appendFileSync(logFilePath, line, 'utf8')
    } catch {
      return
    }
  }

  return {
    append(level: DeveloperLogLevel, message: string): DeveloperLogEntry {
      const entry = {
        id: nextId,
        timestamp: new Date().toISOString(),
        level,
        message,
      }
      nextId += 1
      entries.push(entry)
      if (entries.length > maxEntries) {
        entries.splice(0, entries.length - maxEntries)
      }
      appendToFileBestEffort(entry)
      return entry
    },

    getRecentLogs(limit?: number): DeveloperLogEntry[] {
      return entries.slice(-boundedLimit(limit, maxEntries))
    },

    getSnapshot(limit?: number): DeveloperLogSnapshot {
      return {
        entries: this.getRecentLogs(limit),
        logFilePath,
        totalEntries: nextId - 1,
      }
    },
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
