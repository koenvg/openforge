import type { ResolvedContributions } from './plugin/contributionResolver'
import { makePluginViewKey } from './plugin/types'
import type { ShortcutRegistry } from './shortcuts.svelte'
import type { AppView } from './types'

interface AppPluginControllerOptions {
  navigate(view: AppView): void
  executePluginCommand(pluginId: string, commandId: string): void | Promise<unknown>
  activatePlugin(pluginId: string): void | Promise<unknown>
  deactivateAllPlugins(): void | Promise<unknown>
  loadEnabledForProject(projectId: string | null): void | Promise<unknown>
  logError?: (message: string, error: unknown) => void
}

export function createAppPluginController(options: AppPluginControllerOptions) {
  let shortcuts: ShortcutRegistry | null = null
  let registeredShortcutKeys = new Set<string>()
  let currentContributions: ResolvedContributions | null = null
  let selectedProjectId: string | null = null
  const logError = options.logError ?? ((message: string, error: unknown) => {
    console.error(message, error)
  })

  function unregisterShortcuts(): void {
    if (shortcuts) {
      for (const key of registeredShortcutKeys) {
        shortcuts.unregister(key)
      }
    }
    registeredShortcutKeys = new Set()
  }

  function registerShortcuts(contributions: ResolvedContributions): void {
    if (!shortcuts) return

    const nextShortcutKeys = new Set<string>()
    for (const view of contributions.views) {
      if (!view.shortcut) continue
      nextShortcutKeys.add(view.shortcut)
      shortcuts.register(view.shortcut, () => {
        options.navigate(makePluginViewKey(view.pluginId, view.contributionId))
      })
    }

    for (const command of contributions.commands) {
      if (!command.shortcut) continue
      nextShortcutKeys.add(command.shortcut)
      shortcuts.register(command.shortcut, () => {
        void options.executePluginCommand(command.pluginId, command.contributionId)
      })
    }

    for (const key of registeredShortcutKeys) {
      if (!nextShortcutKeys.has(key)) {
        shortcuts.unregister(key)
      }
    }
    registeredShortcutKeys = nextShortcutKeys
  }

  function setShortcutRegistry(registry: ShortcutRegistry): void {
    if (shortcuts === registry) return
    unregisterShortcuts()
    shortcuts = registry
    if (currentContributions) {
      registerShortcuts(currentContributions)
    }
  }

  function syncContributions(contributions: ResolvedContributions): void {
    currentContributions = contributions
    registerShortcuts(contributions)
    for (const service of contributions.backgroundServices) {
      void options.activatePlugin(service.pluginId)
    }
  }

  function selectProject(projectId: string | null): void {
    if (projectId === selectedProjectId) return
    selectedProjectId = projectId
    void Promise.resolve(options.loadEnabledForProject(projectId)).catch((error) => {
      logError(`[plugins] Failed to load enabled plugins for visible project ${projectId ?? 'none'}:`, error)
    })
  }

  function dispose(): void {
    unregisterShortcuts()
    shortcuts = null
    void Promise.resolve(options.deactivateAllPlugins()).catch((error) => {
      logError('[plugins] Failed to deactivate all plugins during app teardown:', error)
    })
  }

  return {
    setShortcutRegistry,
    syncContributions,
    selectProject,
    dispose,
  }
}
