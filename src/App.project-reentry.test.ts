import { render } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import { GITHUB_SYNC_VIEW_KEY } from './lib/githubSyncPlugin'
import { installAppTestLifecycle } from './App.test-harness'
import { getLatestComponentProps } from './App.test-fixtures/component-props'
import { activateGithubGlobalView } from './App.test-fixtures/plugin-runtime'
import { createTask } from './App.test-fixtures/tasks'
import App from './App.svelte'


const openTask = createTask({
  id: 'task-open',
  initial_prompt: 'Drilled-in task',
})

describe('App project re-entry from cross-project views', () => {
  installAppTestLifecycle()
  // Regression for #1285: cross-project views (Global Settings, sidebar plugin views)
  // change only currentView and leave activeProjectId pointing at the project, so
  // re-clicking that project used to trip switchToProject's "already active" guard and
  // strand the user on the global view. Clicking it must now re-enter the project.
  it('re-enters the active project when its sidebar row is clicked from global settings', async () => {
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
    // Nothing is drilled in, so there is nothing to back out of. Resetting would only
    // add a dead history entry.
    expect(nav.resetToBoard).not.toHaveBeenCalled()
  })

  it('backs out of an open task detail when the already-active project is re-clicked', async () => {
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
    stores.tasks.set([openTask])
    stores.selectedTaskId.set(openTask.id)
    await tick()

    const props = getLatestComponentProps<{ onSelectProject: (id: string) => void }>(
      vi.mocked(AppSidebar),
      'onSelectProject',
    )
    vi.mocked(nav.restoreProjectView).mockClear()
    vi.mocked(nav.resetToBoard).mockClear()
    vi.mocked(nav.selectFocusBoardTab).mockClear()

    props.onSelectProject('proj-1')

    // A task detail also renders on the board view, so the project row would otherwise
    // be a dead press while a task is open.
    expect(nav.resetToBoard).toHaveBeenCalled()
    expect(nav.selectFocusBoardTab).toHaveBeenCalledWith('proj-1')
    expect(nav.restoreProjectView).not.toHaveBeenCalled()
  })

  it('jumps to the board when clicking the already-active project from a non-board tab', async () => {
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
    stores.currentView.set(GITHUB_SYNC_VIEW_KEY)
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
    const stores = await import('./lib/stores')
    const nav = await import('./lib/router.svelte')
    const pluginStore = await import('./lib/plugin/pluginStore')
    const { GITHUB_SYNC_PLUGIN_ID, GITHUB_SYNC_GLOBAL_VIEW_KEY } = await import('./lib/githubSyncPlugin')
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

    await activateGithubGlobalView()
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
    const stores = await import('./lib/stores')
    const pluginStore = await import('./lib/plugin/pluginStore')
    const { GITHUB_SYNC_PLUGIN_ID, GITHUB_SYNC_GLOBAL_VIEW_KEY } = await import('./lib/githubSyncPlugin')
    const IconRail = (await import('./components/shell/IconRail.svelte')).default
    const { get } = await import('svelte/store')
    const { tick } = await import('svelte')

    stores.currentView.set('board')
    render(App)
    await vi.waitFor(() => {
      expect(get(stores.activeProjectId)).toBe('proj-1')
      expect(get(pluginStore.installedPlugins).has(GITHUB_SYNC_PLUGIN_ID)).toBe(true)
    })

    await activateGithubGlobalView()

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
