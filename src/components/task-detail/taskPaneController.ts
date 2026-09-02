import { get, type Unsubscriber, type Writable } from 'svelte/store'
import type { ResolvedTab } from '../../lib/plugin/contributionResolver'
import type { ShortcutRegistry } from '../../lib/shortcuts.svelte'
import { getTaskPaneShortcut } from '../../lib/taskPaneShortcuts'

export interface TaskPaneContext {
  taskId: string
  workspacePath: string | null
  tabs: readonly ResolvedTab[]
}

interface TaskPaneControllerOptions {
  activeViews: Writable<Map<string, string>>
  shortcuts: ShortcutRegistry
  onActiveViewChange: (viewId: string) => void
  onTogglePanel: () => void
}

export interface TaskPaneController {
  readonly activeView: string
  readonly tabs: readonly ResolvedTab[]
  sync(context: TaskPaneContext): void
  select(viewId: string): void
  selectForTask(taskId: string, viewId: string): void
  handleWorkspaceResolved(taskId: string, workspacePath: string | null): void
  isPluginView(viewId: string): boolean
  destroy(): void
}

function sortTabs(tabs: readonly ResolvedTab[]): ResolvedTab[] {
  return [...tabs].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
}

export function createTaskPaneController({
  activeViews,
  shortcuts,
  onActiveViewChange,
  onTogglePanel,
}: TaskPaneControllerOptions): TaskPaneController {
  let activeView = 'agent'
  let currentTaskId = ''
  let currentTabs: ResolvedTab[] = []
  let currentWorkspacePath: string | null = null
  let shortcutConfiguration: string | null = null
  let registeredShortcuts: string[] = []
  let destroyed = false

  function findTab(viewId: string): ResolvedTab | null {
    return currentTabs.find((tab) => tab.namespacedId === viewId) ?? null
  }

  function availableTabs(): ResolvedTab[] {
    return currentWorkspacePath === null
      ? currentTabs.filter((tab) => !tab.requiresWorkspace)
      : currentTabs
  }

  function normalizeStoredView(viewId: string): string {
    if (viewId === 'agent' || viewId === 'review') return viewId
    if (viewId === 'code') return 'agent'

    const namespacedMatch = findTab(viewId)
    if (namespacedMatch !== null) return namespacedMatch.namespacedId

    const legacyMatch = currentTabs.find((tab) => tab.contributionId === viewId)
    return legacyMatch?.namespacedId ?? 'agent'
  }

  function updateActiveView(viewId: string): void {
    if (viewId === activeView) return
    activeView = viewId
    onActiveViewChange(viewId)
  }

  function syncActiveView(views: Map<string, string>): void {
    if (currentTaskId === '') return
    updateActiveView(normalizeStoredView(views.get(currentTaskId) ?? 'agent'))
  }

  const unsubscribeActiveViews: Unsubscriber = activeViews.subscribe(syncActiveView)

  function unregisterShortcuts(): void {
    registeredShortcuts.forEach((shortcut) => shortcuts.unregister(shortcut))
    registeredShortcuts = []
  }

  function registerShortcut(key: string, handler: () => void): void {
    shortcuts.register(key, handler)
    registeredShortcuts.push(key)
  }

  function configureShortcuts(): void {
    const tabs = availableTabs()
    const navigationAvailable = currentWorkspacePath !== null || tabs.length > 0
    const nextConfiguration = [
      currentWorkspacePath === null ? 'unavailable' : 'available',
      ...tabs.map((tab) => tab.namespacedId),
    ].join('\n')
    if (nextConfiguration === shortcutConfiguration) return

    unregisterShortcuts()
    shortcutConfiguration = nextConfiguration
    if (!navigationAvailable) return

    registerShortcut('⌘1', () => select('agent'))
    registerShortcut('⌘2', () => select('review'))
    tabs.forEach((tab, index) => {
      const shortcut = getTaskPaneShortcut(index)
      if (shortcut !== null) {
        registerShortcut(shortcut, () => select(tab.namespacedId))
      }
    })
    if (currentWorkspacePath !== null) registerShortcut('⌘/', onTogglePanel)
  }

  function sync(context: TaskPaneContext): void {
    if (destroyed) return

    currentTaskId = context.taskId
    currentTabs = sortTabs(context.tabs)
    currentWorkspacePath = context.workspacePath
    syncActiveView(get(activeViews))
    configureShortcuts()
  }

  function selectForTask(taskId: string, viewId: string): void {
    if (destroyed) return

    const updated = new Map(get(activeViews))
    updated.set(taskId, viewId)
    activeViews.set(updated)
  }

  function select(viewId: string): void {
    if (currentTaskId === '') return
    selectForTask(currentTaskId, viewId)
  }

  function handleWorkspaceResolved(taskId: string, workspacePath: string | null): void {
    const activePluginTab = findTab(activeView)
    if (
      taskId === currentTaskId
      && workspacePath === null
      && activeView !== 'agent'
      && activeView !== 'review'
      && activePluginTab?.requiresWorkspace !== false
    ) {
      selectForTask(taskId, 'agent')
    }
  }

  function isPluginView(viewId: string): boolean {
    return findTab(viewId) !== null
  }

  function destroy(): void {
    if (destroyed) return
    destroyed = true
    unsubscribeActiveViews()
    unregisterShortcuts()
  }

  return {
    get activeView() { return activeView },
    get tabs() { return availableTabs() },
    sync,
    select,
    selectForTask,
    handleWorkspaceResolved,
    isPluginView,
    destroy,
  }
}
