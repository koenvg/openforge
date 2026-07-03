import { mkdirSync, appendFileSync } from 'node:fs'
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

export function createDeveloperLogStore(options: DeveloperLogStoreOptions = {}): DeveloperLogStore {
  const maxEntries = boundedLimit(options.maxEntries, DEFAULT_UI_TAIL_LIMIT)
  const logFilePath = options.logFilePath ?? defaultDeveloperLogPath()
  const entries: DeveloperLogEntry[] = []
  let nextId = 1

  function appendToFile(entry: DeveloperLogEntry): void {
    mkdirSync(dirname(logFilePath), { recursive: true })
    appendFileSync(logFilePath, formatLogFileLine(entry), 'utf8')
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
      appendToFile(entry)
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
