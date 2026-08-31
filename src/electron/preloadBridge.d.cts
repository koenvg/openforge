interface PreloadBridgeIpcRenderer {
  invoke(channel: string, payload: unknown): Promise<unknown>
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void
  off(channel: string, listener: (event: unknown, payload: unknown) => void): void
}

interface OpenForgePreloadApi {
  readonly version: 1
  invoke(command: string, payload?: unknown): Promise<unknown>
  onEvent(eventName: string, handler: (payload: unknown) => void): () => void
  onEventReady(eventName: string, handler: (payload: unknown) => void): Promise<() => void>
}

declare const preloadBridge: {
  readonly OPENFORGE_INVOKE_CHANNEL: 'openforge:invoke'
  readonly OPENFORGE_EVENT_CHANNEL: 'openforge:event'
  readonly OPENFORGE_APP_EVENTS_RECONNECTED_EVENT: 'openforge-app-events-reconnected'
  createOpenForgePreloadApi(ipcRenderer: PreloadBridgeIpcRenderer): OpenForgePreloadApi
}

export = preloadBridge
