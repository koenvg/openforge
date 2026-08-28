import { get } from 'svelte/store'
import { createDesktopWindow } from './desktopWindow'
import type { DesktopWindowTarget } from './desktopWindow'
import { registerAppDesktopEventListeners } from './appDesktopEventListeners'
import { createAppLifecycleController } from './appLifecycleController'
import { registerAppShortcuts } from './appShortcuts'
import type { AppShortcutHandlers } from './appShortcuts'
import { loadAppStartupData } from './appStartup'
import { getAppMode } from './ipc'
import {
  initializePluginRuntime,
  loadEnabledForApp,
  loadEnabledForProject,
} from './plugin/pluginRegistry'
import { activeProjectId } from './stores'
import { useShortcutRegistry } from './shortcuts.svelte'
import type { ShortcutRegistry } from './shortcuts.svelte'

interface AppShellData {
  loadProjects(): Promise<void>
  loadTasks(): Promise<void>
  loadSessions(): void | Promise<void>
  loadPullRequests(): void | Promise<void>
  loadProjectAttention(): void | Promise<void>
  refreshPrCounts(): void | Promise<void>
}

interface AppShellPluginOwner {
  setShortcutRegistry(shortcuts: ShortcutRegistry): void
  dispose(): void
}

interface AppShellLifecycleControllerOptions {
  appData: AppShellData
  shortcutHandlers: AppShortcutHandlers
  pluginOwner: AppShellPluginOwner
  onCloseRequested(event: { preventDefault(): void }): void
  setAppMode(mode: string | null): void
  onWindowFocusChange(focused: boolean): void
}

export function createAppShellLifecycleController(options: AppShellLifecycleControllerOptions) {
  let appWindow: DesktopWindowTarget | null = null
  const lifecycle = createAppLifecycleController({
    createWindow: () => {
      appWindow = createDesktopWindow()
      return appWindow
    },
    createShortcuts: () => {
      const shortcuts = useShortcutRegistry()
      options.pluginOwner.setShortcutRegistry(shortcuts)
      return shortcuts
    },
    registerShortcuts: (shortcuts) => {
      registerAppShortcuts(shortcuts, options.shortcutHandlers)
    },
    registerDesktopEvents: (target) => registerAppDesktopEventListeners({
      appWindow: target,
      onCloseRequested: options.onCloseRequested,
      loadTasks: options.appData.loadTasks,
      loadSessions: options.appData.loadSessions,
      loadPullRequests: options.appData.loadPullRequests,
      loadProjectAttention: options.appData.loadProjectAttention,
      refreshPrCounts: options.appData.refreshPrCounts,
      getActiveProjectId: () => get(activeProjectId),
      loadEnabledPluginsForProject: loadEnabledForProject,
    }),
    loadRendererStartupData: () => loadAppStartupData({
      initializePluginRuntime: async () => {
        await initializePluginRuntime()
        await loadEnabledForApp()
      },
      loadProjects: options.appData.loadProjects,
      getAppMode,
      setAppMode: options.setAppMode,
      loadProjectAttention: options.appData.loadProjectAttention,
      loadTasks: options.appData.loadTasks,
    }),
    onWindowFocusChange: options.onWindowFocusChange,
  })

  function dispose(): void {
    options.pluginOwner.dispose()
    lifecycle.dispose()
  }

  return {
    start: lifecycle.start,
    dispose,
    get appWindow() {
      return appWindow
    },
  }
}
