import { get, writable } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import type { ResolvedTab } from '../../lib/plugin/contributionResolver'
import type { ShortcutHandler, ShortcutRegistry } from '../../lib/shortcuts.svelte'
import { createTaskPaneController } from './taskPaneController'

function tab(
  pluginId: string,
  contributionId: string,
  title: string,
  order: number,
  requiresWorkspace = true,
): ResolvedTab {
  return {
    pluginId,
    contributionId,
    namespacedId: `${pluginId}:${contributionId}`,
    title,
    icon: null,
    order,
    requiresWorkspace,
  }
}

function createShortcutRegistry() {
  const handlers = new Map<string, ShortcutHandler>()
  const registry: ShortcutRegistry = {
    register: vi.fn((key, handler) => handlers.set(key, handler)),
    unregister: vi.fn((key) => handlers.delete(key)),
    handleKeydown: vi.fn(),
  }

  return { handlers, registry }
}

function setup(initialViews = new Map<string, string>()) {
  const activeViews = writable(initialViews)
  const shortcuts = createShortcutRegistry()
  const onActiveViewChange = vi.fn()
  const onTogglePanel = vi.fn()
  const controller = createTaskPaneController({
    activeViews,
    shortcuts: shortcuts.registry,
    onActiveViewChange,
    onTogglePanel,
  })

  return { activeViews, controller, onActiveViewChange, onTogglePanel, ...shortcuts }
}

describe('taskPaneController', () => {
  it('sorts dynamic plugin tabs and assigns shortcuts from the resulting order', () => {
    const { controller, handlers } = setup()
    const later = tab('plugin-b', 'later', 'Zulu', 20)
    const alpha = tab('plugin-a', 'alpha', 'Alpha', 10)
    const beta = tab('plugin-c', 'beta', 'Beta', 10)

    controller.sync({
      taskId: 'T-1',
      workspacePath: '/worktree',
      tabs: [later, beta, alpha],
    })

    expect(controller.tabs.map((item) => item.namespacedId)).toEqual([
      alpha.namespacedId,
      beta.namespacedId,
      later.namespacedId,
    ])

    handlers.get('⌘3')?.(new KeyboardEvent('keydown'))
    expect(controller.activeView).toBe(alpha.namespacedId)
    handlers.get('⌘4')?.(new KeyboardEvent('keydown'))
    expect(controller.activeView).toBe(beta.namespacedId)
  })

  it('restores namespaced and legacy persisted views without collapsing plugin id collisions', () => {
    const first = tab('plugin-a', 'shared', 'First', 10)
    const second = tab('plugin-b', 'shared', 'Second', 20)
    const { controller } = setup(new Map([
      ['T-1', second.namespacedId],
      ['T-2', 'shared'],
      ['T-3', 'code'],
    ]))

    controller.sync({ taskId: 'T-1', workspacePath: '/one', tabs: [first, second] })
    expect(controller.activeView).toBe(second.namespacedId)

    controller.sync({ taskId: 'T-2', workspacePath: '/two', tabs: [first, second] })
    expect(controller.activeView).toBe(first.namespacedId)

    controller.sync({ taskId: 'T-3', workspacePath: '/three', tabs: [first, second] })
    expect(controller.activeView).toBe('agent')
  })

  it('persists selections per task using reactive Map replacement', () => {
    const initial = new Map([['T-2', 'review']])
    const { activeViews, controller } = setup(initial)

    controller.sync({ taskId: 'T-1', workspacePath: '/one', tabs: [] })
    controller.select('review')

    const updated = get(activeViews)
    expect(updated).not.toBe(initial)
    expect(updated).toEqual(new Map([
      ['T-2', 'review'],
      ['T-1', 'review'],
    ]))

    controller.sync({ taskId: 'T-2', workspacePath: '/two', tabs: [] })
    expect(controller.activeView).toBe('review')
  })

  it('reacts to external persisted-view updates for the current task', () => {
    const { activeViews, controller, onActiveViewChange } = setup()
    controller.sync({ taskId: 'T-1', workspacePath: '/one', tabs: [] })
    onActiveViewChange.mockClear()

    activeViews.set(new Map([['T-1', 'review']]))

    expect(controller.activeView).toBe('review')
    expect(onActiveViewChange).toHaveBeenCalledWith('review')
  })

  it('falls back from a plugin view only after the current task resolves without a workspace', () => {
    const pluginTab = tab('plugin-a', 'pane', 'Pane', 10)
    const { activeViews, controller } = setup(new Map([['T-1', pluginTab.namespacedId]]))
    controller.sync({ taskId: 'T-1', workspacePath: null, tabs: [pluginTab] })
    expect(controller.activeView).toBe(pluginTab.namespacedId)

    controller.handleWorkspaceResolved('T-other', null)
    expect(controller.activeView).toBe(pluginTab.namespacedId)

    controller.handleWorkspaceResolved('T-1', null)
    expect(controller.activeView).toBe('agent')
    expect(get(activeViews).get('T-1')).toBe('agent')
  })

  it('keeps a workspace-optional plugin view active when workspace resolution is unavailable', () => {
    const filesTab = tab('plugin.files', 'files', 'Files', 10, false)
    const requiredTab = tab('plugin.shell', 'terminal', 'Terminal', 20)
    const { activeViews, controller, handlers } = setup(new Map([['T-1', filesTab.namespacedId]]))
    controller.sync({ taskId: 'T-1', workspacePath: null, tabs: [requiredTab, filesTab] })

    expect(controller.tabs).toEqual([filesTab])
    expect([...handlers.keys()]).toEqual(['⌘1', '⌘2', '⌘3'])
    controller.handleWorkspaceResolved('T-1', null)

    expect(controller.activeView).toBe(filesTab.namespacedId)
    expect(get(activeViews).get('T-1')).toBe(filesTab.namespacedId)
  })

  it('registers built-in shortcuts when an available workspace has no plugin tabs', () => {
    const { controller, handlers } = setup()

    controller.sync({ taskId: 'T-1', workspacePath: '/one', tabs: [] })

    expect([...handlers.keys()]).toEqual(['⌘1', '⌘2', '⌘/'])
  })

  it('replaces stale shortcut registrations when tabs or workspace availability change', () => {
    const first = tab('plugin-a', 'first', 'First', 10)
    const second = tab('plugin-b', 'second', 'Second', 20)
    const { controller, handlers, onTogglePanel } = setup()

    controller.sync({ taskId: 'T-1', workspacePath: '/one', tabs: [first, second] })
    expect([...handlers.keys()]).toEqual(['⌘1', '⌘2', '⌘3', '⌘4', '⌘/'])
    handlers.get('⌘/')?.(new KeyboardEvent('keydown'))
    expect(onTogglePanel).toHaveBeenCalledOnce()

    controller.sync({ taskId: 'T-1', workspacePath: '/one', tabs: [second] })
    expect([...handlers.keys()]).toEqual(['⌘1', '⌘2', '⌘3', '⌘/'])
    handlers.get('⌘3')?.(new KeyboardEvent('keydown'))
    expect(controller.activeView).toBe(second.namespacedId)

    controller.sync({ taskId: 'T-1', workspacePath: null, tabs: [second] })
    expect(handlers.size).toBe(0)

  })

  it('removes live shortcuts and unsubscribes from persisted views when destroyed', () => {
    const { activeViews, controller, handlers, onActiveViewChange } = setup()
    controller.sync({ taskId: 'T-1', workspacePath: '/one', tabs: [] })
    onActiveViewChange.mockClear()

    controller.destroy()
    activeViews.set(new Map([['T-1', 'review']]))

    expect(handlers.size).toBe(0)
    expect(onActiveViewChange).not.toHaveBeenCalled()
    expect(controller.activeView).toBe('agent')
  })
})
