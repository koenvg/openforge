import { pluginInvoke } from '../../../src/lib/ipc'

export class PluginContextImpl {
  readonly pluginId: string
  private readonly invokeHostFn: (command: string, payload?: unknown) => Promise<unknown>
  private readonly onEventFn: (event: string, handler: (data: unknown) => void) => () => void
  private readonly storageGetFn: (key: string) => Promise<string | null>
  private readonly storageSetFn: (key: string, value: string) => Promise<void>

  constructor(opts: {
    pluginId: string
    invokeHost: (command: string, payload?: unknown) => Promise<unknown>
    onEvent: (event: string, handler: (data: unknown) => void) => () => void
    storageGet: (key: string) => Promise<string | null>
    storageSet: (key: string, value: string) => Promise<void>
  }) {
    this.pluginId = opts.pluginId
    this.invokeHostFn = opts.invokeHost
    this.onEventFn = opts.onEvent
    this.storageGetFn = opts.storageGet
    this.storageSetFn = opts.storageSet
  }

  async invokeHost(command: string, payload?: unknown): Promise<unknown> {
    return this.invokeHostFn(command, payload)
  }

  async invokeBackend(method: string, payload?: unknown): Promise<unknown> {
    return pluginInvoke(this.pluginId, method, payload ?? null)
  }

  onEvent(event: string, handler: (data: unknown) => void): () => void {
    return this.onEventFn(event, handler)
  }

  async storageGet(key: string): Promise<string | null> {
    return this.storageGetFn(key)
  }

  async storageSet(key: string, value: string): Promise<void> {
    return this.storageSetFn(key, value)
  }
}
