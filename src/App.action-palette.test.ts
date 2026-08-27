import { fireEvent, render } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'svelte'
import { createGithubSyncResult, createPullRequest } from './App.test-fixtures/github'
import { installAppTestLifecycle } from './App.test-harness'
import { getLatestComponentProps } from './App.test-fixtures/component-props'
import { createTask } from './App.test-fixtures/tasks'

type ActionPaletteProps = ComponentProps<
  typeof import('./components/shell/ActionPalette.svelte').default
>

describe('App action palette shortcuts', () => {
  installAppTestLifecycle()
  describe('keyboard shortcuts', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('action palette merge-pr updates the selected Task locally without forcing GitHub Sync', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const actionPaletteModule = await import('./components/shell/ActionPalette.svelte')
      const { get } = await import('svelte/store')

      const selectedTask = createTask({
        id: 'task-merge',
        initial_prompt: 'Merge ready PR',
      })

      const readyPr = createPullRequest({ ticket_id: selectedTask.id })

      vi.mocked(ipc.getTasksForProject).mockResolvedValue([selectedTask])
      vi.mocked(ipc.getPullRequests).mockResolvedValue([readyPr])
      vi.mocked(ipc.mergePullRequest).mockResolvedValue(undefined)
      vi.mocked(ipc.forceGithubSync).mockResolvedValue(createGithubSyncResult())

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)
      stores.ticketPrs.set(new Map([[selectedTask.id, [readyPr]]]))

      render(App)

      await vi.waitFor(() => {
        expect(ipc.getTasksForProject).toHaveBeenCalled()
      })

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })

      const props = getLatestComponentProps<ActionPaletteProps>(
        vi.mocked(actionPaletteModule.default),
        'onExecute',
        { latestCallOnly: true },
      )

      await props.onExecute('merge-pr:squash', 'squash')

      expect(ipc.mergePullRequest).toHaveBeenCalledWith(
        selectedTask.id,
        readyPr.id,
        'abc123',
        'squash',
      )
      expect(ipc.forceGithubSync).not.toHaveBeenCalled()

      const mergedPr = get(stores.ticketPrs).get(selectedTask.id)?.[0]
      expect(mergedPr?.state).toBe('merged')
      expect(mergedPr?.merged_at).not.toBeNull()
    })

    it('action palette merge-pr marks the task as merging while the merge request is in flight', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const actionPaletteModule = await import('./components/shell/ActionPalette.svelte')
      const { get } = await import('svelte/store')

      const selectedTask = createTask({
        id: 'task-merge-pending',
        initial_prompt: 'Merge pending PR',
      })

      const readyPr = createPullRequest({ ticket_id: selectedTask.id })

      let resolveMerge!: () => void
      vi.mocked(ipc.getTasksForProject).mockResolvedValue([selectedTask])
      vi.mocked(ipc.getPullRequests).mockResolvedValue([readyPr])
      vi.mocked(ipc.mergePullRequest).mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveMerge = resolve
      }))
      vi.mocked(ipc.forceGithubSync).mockResolvedValue(createGithubSyncResult())

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)
      stores.ticketPrs.set(new Map([[selectedTask.id, [readyPr]]]))
      stores.mergingTaskIds.set(new Set())

      render(App)

      await vi.waitFor(() => {
        expect(ipc.getTasksForProject).toHaveBeenCalled()
      })

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })

      const props = getLatestComponentProps<ActionPaletteProps>(
        vi.mocked(actionPaletteModule.default),
        'onExecute',
        { latestCallOnly: true },
      )

      const execution = props.onExecute('merge-pr:squash', 'squash')

      await vi.waitFor(() => {
        expect(get(stores.mergingTaskIds).has(selectedTask.id)).toBe(true)
      })

      const otherTaskId = 'task-selected-later'
      stores.tasks.set([selectedTask, { ...selectedTask, id: otherTaskId, initial_prompt: 'Selected later' }])
      stores.selectedTaskId.set(otherTaskId)

      resolveMerge()
      await execution

      expect(get(stores.mergingTaskIds).has(selectedTask.id)).toBe(false)
      expect(get(stores.ticketPrs).get(selectedTask.id)?.[0].state).toBe('merged')
      expect(get(stores.selectedTaskId)).toBe(otherTaskId)
    })

    it('action palette merge-pr does not merge when multiple PRs are ready', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const actionPaletteModule = await import('./components/shell/ActionPalette.svelte')
      const { get } = await import('svelte/store')

      const selectedTask = createTask({
        id: 'task-merge-many',
        initial_prompt: 'Task with multiple ready PRs',
      })

      const firstReadyPr = createPullRequest({
        ticket_id: selectedTask.id,
        title: 'First ready PR',
      })

      const secondReadyPr = createPullRequest({
        id: 99,
        ticket_id: selectedTask.id,
        title: 'Second ready PR',
        url: 'https://github.com/owner/repo/pull/99',
        head_sha: 'def456',
      })

      vi.mocked(ipc.getTasksForProject).mockResolvedValue([selectedTask])
      vi.mocked(ipc.getPullRequests).mockResolvedValue([firstReadyPr, secondReadyPr])
      vi.mocked(ipc.mergePullRequest).mockResolvedValue(undefined)
      vi.mocked(ipc.forceGithubSync).mockResolvedValue(createGithubSyncResult())

      stores.tasks.set([selectedTask])
      stores.pendingTask.set(null)
      stores.selectedTaskId.set(selectedTask.id)
      stores.ticketPrs.set(new Map([[selectedTask.id, [firstReadyPr, secondReadyPr]]]))

      render(App)

      await vi.waitFor(() => {
        expect(ipc.getTasksForProject).toHaveBeenCalled()
      })

      await fireEvent.keyDown(window, { key: 'k', metaKey: true, bubbles: true })

      await vi.waitFor(() => {
        expect(actionPaletteModule.default).toHaveBeenCalled()
      })

      const props = getLatestComponentProps<ActionPaletteProps>(
        vi.mocked(actionPaletteModule.default),
        'onExecute',
        { latestCallOnly: true },
      )

      await props.onExecute('merge-pr:squash', 'squash')

      expect(ipc.mergePullRequest).not.toHaveBeenCalled()
      expect(ipc.forceGithubSync).not.toHaveBeenCalled()
      expect(get(stores.ticketPrs).get(selectedTask.id)).toEqual([firstReadyPr, secondReadyPr])
      expect(get(stores.error)).toBe('Multiple pull requests are ready to merge. Open the task details to choose the correct PR.')
    })
  })
})
