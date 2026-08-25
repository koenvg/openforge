import { fireEvent, render } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from './lib/types'
import { installAppTestLifecycle } from './App.test-harness'
import { mockLoadEnabledForProject } from './App.test-fixtures/plugin-runtime'

function getLatestComponentProps<T extends Record<string, unknown>>(
  mockComponent: { mock: { calls: unknown[][] } },
  propName: keyof T,
): T {
  for (const call of [...mockComponent.mock.calls].reverse()) {
    const props = call.find(
      (arg): arg is T => typeof arg === 'object' && arg !== null && (propName as PropertyKey) in arg,
    )
    if (props) return props
  }

  throw new Error(`Expected mocked component props with ${String(propName)}`)
}

describe('App navigation shortcuts', () => {
  installAppTestLifecycle()
  describe('keyboard shortcuts', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('CMD+H resets to board view and clears selectedTaskId', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')

      render(App)

      // Simulate being on a task detail view
      stores.selectedTaskId.set('task-123')
      stores.tasks.set([
        {
          id: 'task-123',
          initial_prompt: 'Finish task',
          prompt: null,
          title: null,
          title_source: null,
          title_generated_at: null,
          status: 'doing',
          agent: null,
          permission_mode: null,
          worktree_source: null,
          worktree_branch: null,
          source_ticket_url: null,
          depends_on: [],
          project_id: 'proj-1',
          created_at: 1000,
          updated_at: 1000,
        },
      ])
      stores.currentView.set('settings')

      vi.mocked(nav.resetToBoard).mockClear()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', metaKey: true, bubbles: true }))

      expect(nav.resetToBoard).toHaveBeenCalled()
    })

    it('CMD+G navigates to plugin PR review view', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const pluginStore = await import('./lib/plugin/pluginStore')
      const pluginRegistry = await import('./lib/plugin/pluginRegistry')
      const { GITHUB_SYNC_PLUGIN_ID } = await import('./lib/githubSyncPlugin')
      const { get } = await import('svelte/store')
      const { tick } = await import('svelte')

      stores.currentView.set('board')
      render(App)
      await vi.waitFor(() => {
        expect(mockLoadEnabledForProject).toHaveBeenCalledWith('proj-1')
      })
      await vi.waitFor(() => {
        expect(get(pluginStore.installedPlugins).has(GITHUB_SYNC_PLUGIN_ID)).toBe(true)
      })
      pluginStore.enabledPluginIds.set(new Set([GITHUB_SYNC_PLUGIN_ID]))
      await pluginRegistry.activatePlugin(GITHUB_SYNC_PLUGIN_ID)
      pluginStore.setRuntimeContributionSource(GITHUB_SYNC_PLUGIN_ID, {
        views: [{ id: 'pr_review', title: 'Pull Requests', icon: 'git-pull-request', placement: 'rail', order: 20, shortcut: 'Cmd+G' }],
      })
      await tick()

      await vi.waitFor(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', metaKey: true, bubbles: true }))
        expect(get(stores.currentView)).toBe('plugin:com.openforge.github-sync:pr_review')
      })
    })

  it('CMD+O navigates to the plugin-provided files view', async () => {
    const App = (await import('./App.svelte')).default
    const stores = await import('./lib/stores')
    const { get } = await import('svelte/store')
    const { tick } = await import('svelte')
    const pluginStore = await import('./lib/plugin/pluginStore')
    const pluginRegistry = await import('./lib/plugin/pluginRegistry')
    const { FILE_VIEWER_PLUGIN_ID } = await import('./lib/fileViewerPlugin')

    stores.currentView.set('board')
    render(App)
    await vi.waitFor(() => {
      expect(mockLoadEnabledForProject).toHaveBeenCalledWith('proj-1')
    })
    await vi.waitFor(() => {
      expect(get(pluginStore.installedPlugins).has(FILE_VIEWER_PLUGIN_ID)).toBe(true)
    })
    pluginStore.enabledPluginIds.set(new Set([FILE_VIEWER_PLUGIN_ID]))
    await pluginRegistry.activatePlugin(FILE_VIEWER_PLUGIN_ID)
    pluginStore.setRuntimeContributionSource(FILE_VIEWER_PLUGIN_ID, {
      views: [{ id: 'files', title: 'Files', icon: 'folder-open', placement: 'rail', order: 10, shortcut: 'Cmd+O' }],
    })
    await tick()

    await vi.waitFor(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', metaKey: true, bubbles: true }))
      expect(get(stores.currentView)).toBe('plugin:com.openforge.file-viewer:files')
    })
  })

    it('CMD+S navigates to the Task Schedules plugin view', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const pluginStore = await import('./lib/plugin/pluginStore')
      const pluginRegistry = await import('./lib/plugin/pluginRegistry')
      const { TASK_SCHEDULES_PLUGIN_ID, TASK_SCHEDULES_VIEW_KEY } = await import('./lib/taskSchedulesPlugin')
      const { get } = await import('svelte/store')
      const { tick } = await import('svelte')

      stores.currentView.set('board')
      render(App)
      await vi.waitFor(() => {
        expect(mockLoadEnabledForProject).toHaveBeenCalledWith('proj-1')
      })
      await vi.waitFor(() => {
        expect(get(pluginStore.installedPlugins).has(TASK_SCHEDULES_PLUGIN_ID)).toBe(true)
      })
      pluginStore.enabledPluginIds.set(new Set([TASK_SCHEDULES_PLUGIN_ID]))
      await pluginRegistry.activatePlugin(TASK_SCHEDULES_PLUGIN_ID)
      pluginStore.setRuntimeContributionSource(TASK_SCHEDULES_PLUGIN_ID, {
        views: [{ id: 'schedules', title: 'Task Schedules', icon: 'clock', placement: 'rail', order: 50, shortcut: 'Cmd+S' }],
      })
      await tick()

      await vi.waitFor(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', metaKey: true, bubbles: true }))
        expect(get(stores.currentView)).toBe(TASK_SCHEDULES_VIEW_KEY)
      })
    })

    it('CMD+comma navigates to global settings view', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const { get } = await import('svelte/store')

      render(App)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true }))
      expect(get(stores.currentView)).toBe('global_settings')
    })

    it('dashboard icon resets to board when a task view is open', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')
      const iconRailModule = await import('./components/shell/IconRail.svelte')

      stores.selectedTaskId.set('task-123')
      stores.currentView.set('board')

      render(App)

      await vi.waitFor(() => {
        expect(iconRailModule.default).toHaveBeenCalled()
      })

      const lastCall = vi.mocked(iconRailModule.default).mock.calls.at(-1)
      expect(lastCall).toBeTruthy()

      if (!lastCall) {
        throw new Error('Expected IconRail to receive props')
      }

      const propsCandidate = lastCall
        .flatMap((arg) => {
          if (typeof arg !== 'object' || arg === null) {
            return []
          }

          if ('props' in arg && typeof arg.props === 'object' && arg.props !== null) {
            return [arg, arg.props]
          }

          return [arg]
        })
        .find((arg): arg is { onNavigate: (view: string) => void } => 'onNavigate' in arg && typeof arg.onNavigate === 'function')

      if (!propsCandidate) {
        throw new Error('Expected IconRail props to include onNavigate')
      }

      vi.mocked(nav.resetToBoard).mockClear()

      propsCandidate.onNavigate('board')

      expect(nav.resetToBoard).toHaveBeenCalled()
    })

    it('CMD+K opens the action palette', async () => {
      const App = (await import('./App.svelte')).default
      const actionPaletteModule = await import('./components/shell/ActionPalette.svelte')

      render(App)

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })
    })

    it('CMD+SHIFT+P opens the project switcher', async () => {
      const App = (await import('./App.svelte')).default
      const projectSwitcherModule = await import('./components/project/ProjectSwitcherModal.svelte')

      render(App)

      await fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(projectSwitcherModule.default).toHaveBeenCalled()
      })
    })

    it('CMD+P opens the file quick-open overlay from the board', async () => {
      const App = (await import('./App.svelte')).default
      const projectSwitcherModule = await import('./components/project/ProjectSwitcherModal.svelte')
      const fileQuickOpenModule = await import('./components/shell/FileQuickOpen.svelte')

      render(App)

      await fireEvent.keyDown(window, { key: 'p', metaKey: true, bubbles: true })

      expect(projectSwitcherModule.default).not.toHaveBeenCalled()
      await vi.waitFor(() => {
        expect(fileQuickOpenModule.default).toHaveBeenCalled()
      })
    })

    it('CMD+P opens the file quick-open overlay from plugin views', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const fileQuickOpenModule = await import('./components/shell/FileQuickOpen.svelte')

      stores.currentView.set('plugin:com.openforge.github-sync:pr_review')
      stores.selectedTaskId.set(null)
      render(App)

      await fireEvent.keyDown(window, { key: 'p', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(fileQuickOpenModule.default).toHaveBeenCalled()
      })
    })

    it('CMD+P does not open the file quick-open overlay from task views', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const fileQuickOpenModule = await import('./components/shell/FileQuickOpen.svelte')
      const selectedTask: Task = {
        id: 'task-123',
        initial_prompt: 'Finish task',
        prompt: null,
        title: null,
        title_source: null,
        title_generated_at: null,
        status: 'doing',
        agent: null,
        permission_mode: null,
        worktree_source: null,
        worktree_branch: null,
        source_ticket_url: null,
        depends_on: [],
        project_id: 'proj-1',
        created_at: 1000,
        updated_at: 1000,
      }

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)
      stores.currentView.set('board')
      render(App)

      await fireEvent.keyDown(window, { key: 'p', metaKey: true, bubbles: true })

      expect(fileQuickOpenModule.default).not.toHaveBeenCalled()
    })

  })

  describe('project re-entry from cross-project views', () => {
    // Regression for #1285: cross-project views (Global Settings, sidebar plugin views)
    // change only currentView and leave activeProjectId pointing at the project, so
    // re-clicking that project used to trip switchToProject's "already active" guard and
    // strand the user on the global view. Clicking it must now re-enter the project.
    it('re-enters the active project when its sidebar row is clicked from global settings', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')
      const AppSidebar = (await import('./components/shell/AppSidebar.svelte')).default
      const { get } = await import('svelte/store')
      const { tick } = await import('svelte')

      render(App)
      await vi.waitFor(() => {
        expect(vi.mocked(AppSidebar)).toHaveBeenCalled()
      })

      stores.activeProjectId.set('proj-1')
      stores.currentView.set('global_settings')
      await tick()

      const props = getLatestComponentProps<{ onSelectProject: (id: string) => void }>(
        vi.mocked(AppSidebar),
        'onSelectProject',
      )
      vi.mocked(nav.restoreProjectView).mockClear()

      props.onSelectProject('proj-1')

      expect(nav.restoreProjectView).toHaveBeenCalledWith('proj-1')
      expect(get(stores.currentView)).toBe('board')
    })

    it('does not re-navigate when clicking the already-active project on its board', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')
      const AppSidebar = (await import('./components/shell/AppSidebar.svelte')).default
      const { tick } = await import('svelte')

      render(App)
      await vi.waitFor(() => {
        expect(vi.mocked(AppSidebar)).toHaveBeenCalled()
      })

      stores.activeProjectId.set('proj-1')
      stores.currentView.set('board')
      await tick()

      const props = getLatestComponentProps<{ onSelectProject: (id: string) => void }>(
        vi.mocked(AppSidebar),
        'onSelectProject',
      )
      vi.mocked(nav.restoreProjectView).mockClear()
      vi.mocked(nav.resetToBoard).mockClear()

      props.onSelectProject('proj-1')

      expect(nav.restoreProjectView).not.toHaveBeenCalled()
      // Re-clicking the project while already on its board tab must not reset — that
      // would wipe an open task detail (which renders on the board view).
      expect(nav.resetToBoard).not.toHaveBeenCalled()
    })

    it('jumps to the board when clicking the already-active project from a non-board tab', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')
      const AppSidebar = (await import('./components/shell/AppSidebar.svelte')).default
      const { get } = await import('svelte/store')
      const { tick } = await import('svelte')

      render(App)
      await vi.waitFor(() => {
        expect(vi.mocked(AppSidebar)).toHaveBeenCalled()
      })

      stores.activeProjectId.set('proj-1')
      // A per-project (non-cross-project) tab: the github-sync Pull Requests rail view.
      stores.currentView.set('plugin:com.openforge.github-sync:pr_review')
      await tick()

      const props = getLatestComponentProps<{ onSelectProject: (id: string) => void }>(
        vi.mocked(AppSidebar),
        'onSelectProject',
      )
      vi.mocked(nav.resetToBoard).mockClear()
      vi.mocked(nav.restoreProjectView).mockClear()

      props.onSelectProject('proj-1')

      // Re-clicking the active project from another of its tabs is a shortcut back to
      // the Dashboard (board) — not a full project re-entry.
      expect(nav.resetToBoard).toHaveBeenCalled()
      expect(nav.restoreProjectView).not.toHaveBeenCalled()
      expect(get(stores.currentView)).toBe('board')
    })

    it('re-enters the active project when clicked from a cross-project sidebar plugin view', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')
      const pluginStore = await import('./lib/plugin/pluginStore')
      const pluginRegistry = await import('./lib/plugin/pluginRegistry')
      const { GITHUB_SYNC_PLUGIN_ID, GITHUB_SYNC_GLOBAL_VIEW_ID, GITHUB_SYNC_GLOBAL_VIEW_KEY } = await import('./lib/githubSyncPlugin')
      const AppSidebar = (await import('./components/shell/AppSidebar.svelte')).default
      const { get } = await import('svelte/store')
      const { tick } = await import('svelte')

      stores.currentView.set('board')
      render(App)

      // Let startup settle the active project so registering the sidebar view below is
      // not clobbered by the project's plugin (re)load.
      await vi.waitFor(() => {
        expect(get(stores.activeProjectId)).toBe('proj-1')
        expect(get(pluginStore.installedPlugins).has(GITHUB_SYNC_PLUGIN_ID)).toBe(true)
      })

      pluginStore.enabledPluginIds.set(new Set([GITHUB_SYNC_PLUGIN_ID]))
      await pluginRegistry.activatePlugin(GITHUB_SYNC_PLUGIN_ID)
      // Register the github-sync global "All Pull Requests" view as a sidebar (cross-project) view.
      pluginStore.setRuntimeContributionSource(GITHUB_SYNC_PLUGIN_ID, {
        views: [{ id: GITHUB_SYNC_GLOBAL_VIEW_ID, title: 'All Pull Requests', icon: 'git-pull-request', placement: 'sidebar', order: 20 }],
      })
      await tick()

      stores.currentView.set(GITHUB_SYNC_GLOBAL_VIEW_KEY)
      await tick()

      const props = getLatestComponentProps<{ onSelectProject: (id: string) => void }>(
        vi.mocked(AppSidebar),
        'onSelectProject',
      )
      vi.mocked(nav.restoreProjectView).mockClear()

      props.onSelectProject('proj-1')

      expect(nav.restoreProjectView).toHaveBeenCalledWith('proj-1')
    })

    it('hides the per-project IconRail on a cross-project sidebar plugin view', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const pluginStore = await import('./lib/plugin/pluginStore')
      const pluginRegistry = await import('./lib/plugin/pluginRegistry')
      const { GITHUB_SYNC_PLUGIN_ID, GITHUB_SYNC_GLOBAL_VIEW_ID, GITHUB_SYNC_GLOBAL_VIEW_KEY } = await import('./lib/githubSyncPlugin')
      const IconRail = (await import('./components/shell/IconRail.svelte')).default
      const { get } = await import('svelte/store')
      const { tick } = await import('svelte')

      stores.currentView.set('board')
      render(App)
      await vi.waitFor(() => {
        expect(get(stores.activeProjectId)).toBe('proj-1')
        expect(get(pluginStore.installedPlugins).has(GITHUB_SYNC_PLUGIN_ID)).toBe(true)
      })

      pluginStore.enabledPluginIds.set(new Set([GITHUB_SYNC_PLUGIN_ID]))
      await pluginRegistry.activatePlugin(GITHUB_SYNC_PLUGIN_ID)
      pluginStore.setRuntimeContributionSource(GITHUB_SYNC_PLUGIN_ID, {
        views: [{ id: GITHUB_SYNC_GLOBAL_VIEW_ID, title: 'All Pull Requests', icon: 'git-pull-request', placement: 'sidebar', order: 20 }],
      })
      await tick()

      // The per-project rail is mounted on the board; moving to a cross-project sidebar
      // view must unmount it, so returning to the board remounts it (a fresh render call).
      // A mocked component is only invoked on mount, never on prop change (verified), so
      // if the rail wrongly stayed mounted on the cross-project view there would be no
      // remount call here.
      stores.currentView.set(GITHUB_SYNC_GLOBAL_VIEW_KEY)
      await tick()
      vi.mocked(IconRail).mockClear()
      stores.currentView.set('board')
      await tick()

      expect(vi.mocked(IconRail)).toHaveBeenCalled()
    })
  })
})
