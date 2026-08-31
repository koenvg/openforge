import preloadBridge from './preloadBridge.cjs'

export const OPENFORGE_INVOKE_CHANNEL: 'openforge:invoke' = preloadBridge.OPENFORGE_INVOKE_CHANNEL
export const OPENFORGE_EVENT_CHANNEL: 'openforge:event' = preloadBridge.OPENFORGE_EVENT_CHANNEL
export const OPENFORGE_APP_EVENTS_RECONNECTED_EVENT: 'openforge-app-events-reconnected' = preloadBridge.OPENFORGE_APP_EVENTS_RECONNECTED_EVENT

export interface PreloadIpcRenderer {
  invoke(channel: string, payload: unknown): Promise<unknown>
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void
  off(channel: string, listener: (event: unknown, payload: unknown) => void): void
}

export interface OpenForgePreloadApi {
  readonly version: 1
  invoke(command: string, payload?: unknown): Promise<unknown>
  onEvent(eventName: string, handler: (payload: unknown) => void): () => void
  onEventReady(eventName: string, handler: (payload: unknown) => void): Promise<() => void>
}

export const createOpenForgePreloadApi: (ipcRenderer: PreloadIpcRenderer) => OpenForgePreloadApi = preloadBridge.createOpenForgePreloadApi
