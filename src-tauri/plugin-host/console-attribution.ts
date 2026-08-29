import { AsyncLocalStorage } from 'node:async_hooks'
import { Console } from 'node:console'
import { Writable } from 'node:stream'

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
let pluginConsoleRoutingInstalled = false
const FORMATTED_PLUGIN_CONSOLE_METHODS = ['debug', 'error', 'info', 'log', 'warn'] as const

function pluginConsolePrefix(): string {
  const pluginId = pluginConsoleContext.getStore()
  return pluginId ? `[plugin:${pluginId}] ` : '[plugin_host] '
}

function writePluginConsole(values: unknown[]): void {
  process.stderr.write(`${pluginConsolePrefix()}${values.map(formatPluginValue).join(' ')}\n`)
}

function prefixPluginConsoleLines(output: string): string {
  const lines = output.split('\n')
  return lines.map((line, index) => (index === lines.length - 1 && line === '')
    ? ''
    : `${pluginConsolePrefix()}${line}`).join('\n')
}

const pluginConsoleStream = new Writable({
  write(chunk, _encoding, callback) {
    try {
      process.stderr.write(prefixPluginConsoleLines(String(chunk)))
      callback()
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)))
    }
  },
})

export function installPluginConsoleRouting(): void {
  if (pluginConsoleRoutingInstalled) return
  pluginConsoleRoutingInstalled = true

  const routedConsole = new Console({
    stdout: pluginConsoleStream,
    stderr: pluginConsoleStream,
    colorMode: false,
  })
  for (const method of FORMATTED_PLUGIN_CONSOLE_METHODS) {
    routedConsole[method] = (...values: unknown[]) => writePluginConsole(values)
  }
  globalThis.console = routedConsole
}

export async function withPluginConsole<T>(pluginId: string, operation: () => Promise<T> | T): Promise<T> {
  return await pluginConsoleContext.run(pluginId, operation)
}

export function logPluginHostError(pluginId: string, message: string): void {
  process.stderr.write(`[plugin:${pluginId}] ${message}\n`)
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
