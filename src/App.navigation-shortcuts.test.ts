import { fireEvent, render } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makePluginViewKey } from './lib/plugin/types'
import { GITHUB_SYNC_VIEW_KEY } from './lib/githubSyncPlugin'
import { installAppTestLifecycle } from './App.test-harness'
import { mockLoadEnabledForProject } from './App.test-fixtures/plugin-runtime'
import { createTask } from './App.test-fixtures/tasks'
import App from './App.svelte'

const FILE_VIEWER_VIEW_KEY = makePluginViewKey('com.openforge.file-viewer', 'files')

async function waitForProjectPluginsReady(): Promise<void> {
  const { tick } = await import('svelte')

  await vi.waitFor(() => {
    expect(mockLoadEnabledForProject).toHaveBeenCalledWith('proj-1')
  })

  const loadResult = mockLoadEnabledForProject.mock.results.at(-1)
  if (!loadResult || loadResult.type !== 'return') {
    throw new Error('Expected project plugin loading to be in progress')
  }

  await loadResult.value
  await tick()
}

describe('App navigation shortcuts', () => {
  installAppTestLifecycle()
  describe('keyboard shortcuts', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('CMD+H resets to board view and clears selectedTaskId', async () => {
      const stores = await import('./lib/stores')
      const nav = await import('./lib/router.svelte')
      const { tick } = await import('svelte')

      render(App)
      await tick()
      // Simulate being on a task detail view
      stores.selectedTaskId.set('task-123')
      stores.tasks.set([
        createTask({
          id: 'task-123',
          initial_prompt: 'Finish task',
        }),
      ])
      stores.currentView.set('settings')

      vi.mocked(nav.resetToBoard).mockClear()
      await fireEvent.keyDown(window, { key: 'h', metaKey: true, bubbles: true })

      expect(nav.resetToBoard).toHaveBeenCalled()
    })

    it('CMD+G navigates to plugin PR review view', async () => {
      const stores = await import('./lib/stores')
      const { get } = await import('svelte/store')

      stores.currentView.set('board')
      render(App)

      await waitForProjectPluginsReady()

      await fireEvent.keyDown(window, { key: 'g', code: 'KeyG', metaKey: true, bubbles: true })

      expect(get(stores.currentView)).toBe(GITHUB_SYNC_VIEW_KEY)
    })

  it('CMD+O navigates to the plugin-provided files view', async () => {
    const stores = await import('./lib/stores')
    const { get } = await import('svelte/store')

    stores.currentView.set('board')
    render(App)

    await waitForProjectPluginsReady()

    await fireEvent.keyDown(window, { key: 'o', code: 'KeyO', metaKey: true, bubbles: true })

    expect(get(stores.currentView)).toBe(FILE_VIEWER_VIEW_KEY)
  })

    it('CMD+S navigates to the Task Schedules plugin view', async () => {
      const stores = await import('./lib/stores')
      const { TASK_SCHEDULES_VIEW_KEY } = await import('./lib/taskSchedulesPlugin')
      const { get } = await import('svelte/store')

      stores.currentView.set('board')
      render(App)

      await waitForProjectPluginsReady()

      await fireEvent.keyDown(window, { key: 's', code: 'KeyS', metaKey: true, bubbles: true })

      expect(get(stores.currentView)).toBe(TASK_SCHEDULES_VIEW_KEY)
    })

    it('CMD+comma navigates to global settings view', async () => {
      const stores = await import('./lib/stores')
      const { get } = await import('svelte/store')

      render(App)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true }))
      expect(get(stores.currentView)).toBe('global_settings')
    })


    it('CMD+K opens the action palette', async () => {
      const actionPaletteModule = await import('./components/shell/ActionPalette.svelte')

      render(App)

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })
    })

    it('CMD+SHIFT+P opens the project switcher', async () => {
      const projectSwitcherModule = await import('./components/project/ProjectSwitcherModal.svelte')

      render(App)

      await fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(projectSwitcherModule.default).toHaveBeenCalled()
      })
    })

    it('CMD+P opens the file quick-open overlay from the board', async () => {
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
      const stores = await import('./lib/stores')
      const fileQuickOpenModule = await import('./components/shell/FileQuickOpen.svelte')

      stores.currentView.set(GITHUB_SYNC_VIEW_KEY)
      stores.selectedTaskId.set(null)
      render(App)

      await fireEvent.keyDown(window, { key: 'p', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(fileQuickOpenModule.default).toHaveBeenCalled()
      })
    })

    it('CMD+P does not open the file quick-open overlay from task views', async () => {
      const stores = await import('./lib/stores')
      const fileQuickOpenModule = await import('./components/shell/FileQuickOpen.svelte')
      const selectedTask = createTask({
        id: 'task-123',
        initial_prompt: 'Finish task',
      })

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)
      stores.currentView.set('board')
      render(App)

      await fireEvent.keyDown(window, { key: 'p', metaKey: true, bubbles: true })

      expect(fileQuickOpenModule.default).not.toHaveBeenCalled()
    })

  })
})
