import type { DesktopEvent, DesktopUnlistenFn } from '../desktopIpc'

export type AppEventListen = <T>(
  event: string,
  handler: (event: DesktopEvent<T>) => void | Promise<void>,
) => Promise<DesktopUnlistenFn>

export interface AppWindowCloseTarget {
  onCloseRequested(handler: (event: { preventDefault: () => void }) => void): Promise<DesktopUnlistenFn>
}

export interface AppDesktopEventDeps {
  appWindow: AppWindowCloseTarget
  onCloseRequested(event: { preventDefault: () => void }): void
  loadTasks(): Promise<void> | void
  loadSessions(): Promise<void> | void
  loadPullRequests(): Promise<void> | void
  loadProjectAttention(): Promise<void> | void
  refreshPrCounts(): Promise<void> | void
  getActiveProjectId?(): string | null
  reloadInstalledPluginMetadata?(pluginId: string): Promise<boolean> | boolean
  reloadPluginForApp?(pluginId: string): Promise<boolean> | boolean
  reloadPluginForProject?(projectId: string, pluginId: string): Promise<boolean> | boolean
  loadEnabledPluginsForApp?(): Promise<void> | void
  loadEnabledPluginsForProject?(projectId: string): Promise<void> | void
  listen?: AppEventListen
}

export interface DesktopEventListenerRegistration {
  readonly eventName: string
  register(listen: AppEventListen): Promise<DesktopUnlistenFn>
}

export function defineDesktopEventListener<T>(
  eventName: string,
  handler: (event: DesktopEvent<T>) => void | Promise<void>,
): DesktopEventListenerRegistration {
  return {
    eventName,
    register: listen => listen(eventName, handler),
  }
}
