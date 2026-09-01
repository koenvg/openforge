import type { ObservedTaskInvalidation } from '../plugin/pluginTaskInvalidations'
import type { AppDesktopEventName, AppDesktopEventPayloads } from '../desktopIpcContract'
import type { DesktopEvent, DesktopUnlistenFn } from '../desktopIpc'

export type AppEventListen = <TEventName extends AppDesktopEventName>(
  event: TEventName,
  handler: (event: DesktopEvent<AppDesktopEventPayloads[TEventName]>) => void | Promise<void>,
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
  publishTaskInvalidation?(event: ObservedTaskInvalidation): Promise<void> | void
  refreshPrCounts(): Promise<void> | void
  getActiveProjectId?(): string | null
  reloadInstalledPluginMetadata?(pluginId: string): Promise<boolean> | boolean
  reloadPluginForApp?(pluginId: string): Promise<boolean> | boolean
  reloadPluginForProject?(projectId: string, pluginId: string): Promise<boolean> | boolean
  loadEnabledPluginsForApp?(): Promise<void> | void
  loadEnabledPluginsForProject?(projectId: string): Promise<void> | void
  listen?: AppEventListen
}

export interface DesktopEventListenerRegistration<TEventName extends AppDesktopEventName = AppDesktopEventName> {
  readonly eventName: TEventName
  register(listen: AppEventListen): Promise<DesktopUnlistenFn>
}

export function defineDesktopEventListener<TEventName extends AppDesktopEventName>(
  eventName: TEventName,
  handler: (event: DesktopEvent<AppDesktopEventPayloads[TEventName]>) => void | Promise<void>,
): DesktopEventListenerRegistration<TEventName> {
  return {
    eventName,
    register: listen => listen(eventName, handler),
  }
}
