import type { PluginContext, PluginStorage } from './types'

export class PluginContextImpl implements PluginContext {
  readonly pluginId: string
  readonly storage: PluginStorage
  private readonly invokeHostFn: (command: string, payload?: unknown) => Promise<unknown>
  private readonly invokeBackendFn: (method: string, payload?: unknown) => Promise<unknown>
  private readonly onEventFn: (event: string, handler: (data: unknown) => void) => () => void

  constructor(opts: {
    pluginId: string
    invokeHost: (command: string, payload?: unknown) => Promise<unknown>
    invokeBackend: (method: string, payload?: unknown) => Promise<unknown>
    onEvent: (event: string, handler: (data: unknown) => void) => () => void
    storageGet: (key: string) => Promise<string | null>
    storageSet: (key: string, value: string) => Promise<void>
  }) {
    this.pluginId = opts.pluginId
    this.invokeHostFn = opts.invokeHost
    this.invokeBackendFn = opts.invokeBackend
    this.onEventFn = opts.onEvent
    this.storage = {
      get: (key) => opts.storageGet(key),
      set: (key, value) => opts.storageSet(key, value),
    }
  }

  async invokeHost(command: string, payload?: unknown): Promise<unknown> {
    return this.invokeHostFn(command, payload)
  }

  async invokeBackend(method: string, payload?: unknown): Promise<unknown> {
    return this.invokeBackendFn(method, payload)
  }

  onEvent(event: string, handler: (data: unknown) => void): () => void {
    return this.onEventFn(event, handler)
  }
}
