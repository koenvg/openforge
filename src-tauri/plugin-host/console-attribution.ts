import { AsyncLocalStorage } from 'node:async_hooks'

function formatPluginValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const pluginConsoleContext = new AsyncLocalStorage<string>()
let pluginConsoleUsers = 0
let originalPluginConsole: Pick<Console, 'debug' | 'error' | 'info' | 'log' | 'warn'> | null = null

function writePluginConsole(method: keyof NonNullable<typeof originalPluginConsole>, values: unknown[]): void {
  const pluginId = pluginConsoleContext.getStore()
  const original = originalPluginConsole?.[method]
  if (!pluginId) {
    original?.(...values)
    return
  }
  process.stderr.write(`[plugin:${pluginId}] ${values.map(formatPluginValue).join(' ')}\n`)
}

function acquirePluginConsole(): void {
  pluginConsoleUsers += 1
  if (pluginConsoleUsers !== 1) return

  originalPluginConsole = {
    debug: console.debug,
    error: console.error,
    info: console.info,
    log: console.log,
    warn: console.warn,
  }
  console.debug = (...values: unknown[]) => writePluginConsole('debug', values)
  console.error = (...values: unknown[]) => writePluginConsole('error', values)
  console.info = (...values: unknown[]) => writePluginConsole('info', values)
  console.log = (...values: unknown[]) => writePluginConsole('log', values)
  console.warn = (...values: unknown[]) => writePluginConsole('warn', values)
}

function releasePluginConsole(): void {
  pluginConsoleUsers -= 1
  if (pluginConsoleUsers !== 0 || !originalPluginConsole) return

  console.debug = originalPluginConsole.debug
  console.error = originalPluginConsole.error
  console.info = originalPluginConsole.info
  console.log = originalPluginConsole.log
  console.warn = originalPluginConsole.warn
  originalPluginConsole = null
}

export async function withPluginConsole<T>(pluginId: string, operation: () => Promise<T> | T): Promise<T> {
  acquirePluginConsole()
  try {
    return await pluginConsoleContext.run(pluginId, operation)
  } finally {
    releasePluginConsole()
  }
}

export function logPluginHostError(pluginId: string, message: string): void {
  process.stderr.write(`[plugin:${pluginId}] ${message}\n`)
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
