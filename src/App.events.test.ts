import { render } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { PullRequestInfo } from './lib/types'
import { requireDefined } from './test-utils/dom'
import { installAppTestLifecycle } from './App.test-harness'
import { setMockTasks } from './App.test-fixtures/stores'
import { eventListeners } from './App.test-fixtures/ipc'
import { createTask } from './App.test-fixtures/tasks'

describe('App desktop events', { timeout: 15_000 }, () => {
  installAppTestLifecycle()
  describe('github-sync-complete', () => {
    it('preserves locally merged state and definitive mergeability during background sync', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      stores.projects.set([])
      setMockTasks([])
      stores.ticketPrs.set(new Map())
      stores.activeProjectId.set('proj-1')

      vi.mocked(ipc.getProjects).mockResolvedValue([])
      vi.mocked(ipc.readActiveTasks).mockResolvedValue({ tasks: [], related: [] })
      vi.mocked(ipc.getLatestSessions).mockResolvedValue([])
      vi.mocked(ipc.getProjectAttention).mockResolvedValue([{
        project_id: 'proj-1',
        needs_input: 0,
        running_agents: 0,
        ci_failures: 0,
        unaddressed_comments: 0,
        completed_agents: 0
      }])
      vi.mocked(ipc.getProjectConfig).mockResolvedValue(null)

      const prA: PullRequestInfo = {
        id: 42,
        pr_number: 42,
        ticket_id: 'T-42',
        repo_owner: 'owner',
        repo_name: 'repo',
        title: 'PR A',
        url: 'https://example.com',
        state: 'merged',
        merged_at: 1000,
        head_sha: 'abc',
        ci_status: null,
        ci_check_runs: null,
        review_status: null,
        mergeable: true,
        mergeable_state: 'clean',
        created_at: 0,
        updated_at: 0,
        draft: false,
        is_queued: false,
        unaddressed_comment_count: 0,
    merge_readiness_status: null,
    merge_readiness_action: null,
    merge_readiness_blockers: null,
    merge_readiness_warnings: null,
    readiness_source_head_sha: null,
    merge_group_sha: null,
    required_checks_policy_known: null,
    required_reviews_policy_known: null,
    merge_queue_required: null,
    merge_queue_state: null,
    readiness_updated_at: null,
      }
      const prB: PullRequestInfo = {
        ...prA,
        id: 99,
        pr_number: 99,
        ticket_id: 'T-99',
        title: 'PR B',
        state: 'open',
        merged_at: null,
        mergeable: false,
        mergeable_state: 'dirty'
      }
      
      stores.ticketPrs.set(new Map([
        ['T-42', [prA]],
        ['T-99', [prB]]
      ]))

      const transientPrA = { ...prA, state: 'open', merged_at: null }
      const transientPrB = { ...prB, mergeable: null, mergeable_state: 'unknown' }
      vi.mocked(ipc.getPullRequests).mockResolvedValue([transientPrA, transientPrB])

      render(App)

      await vi.waitFor(() => {
        expect(eventListeners.has('github-sync-complete')).toBe(true)
      })

      const syncCallback = requireDefined(
        eventListeners.get('github-sync-complete'),
        'Expected github-sync-complete listener to be registered',
      )
      await syncCallback()

      await new Promise(r => setTimeout(r, 0))

      const map = get(stores.ticketPrs)
      const newPrA = map.get('T-42')?.[0]
      const newPrB = map.get('T-99')?.[0]

      expect(newPrA?.state).toBe('merged')
      expect(newPrA?.merged_at).toBe(1000)

      expect(newPrB?.mergeable).toBe(false)
      expect(newPrB?.mergeable_state).toBe('dirty')
    })
  })

  describe('openforge.open-url', () => {
    it('routes backend Trusted Plugin URL requests through the host URL adapter', async () => {
      const App = (await import('./App.svelte')).default
      const { openUrl } = await import('./lib/ipc')

      render(App)

      await vi.waitFor(() => {
        expect(eventListeners.has('openforge.open-url')).toBe(true)
      })

      const callback = requireDefined(
        eventListeners.get('openforge.open-url'),
        'Expected openforge.open-url listener to be registered',
      )
      await callback({ payload: { url: 'https://example.com/plugin-docs' } })

      expect(openUrl).toHaveBeenCalledWith('https://example.com/plugin-docs')
    })
  })

  describe('task-changed created events', () => {
    it('stores the created task prompt text for the spawned-task toast', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const { readTaskDetail } = await import('./lib/ipc')
      const { get } = await import('svelte/store')

      vi.mocked(readTaskDetail).mockResolvedValue({
        task: createTask({
          id: 'T-99',
          prompt: 'Prompt from task detail',
          projectId: 'proj-1',
          status: 'backlog',
        }),
        related: [],
      })

      render(App)

      await vi.waitFor(() => {
        expect(eventListeners.has('task-changed')).toBe(true)
      })

      const callback = eventListeners.get('task-changed')
      expect(callback).toBeDefined()

      await callback?.({ payload: { action: 'created', task_id: 'T-99', project_id: 'proj-1' } })

      await vi.waitFor(() => {
        expect(get(stores.taskSpawned)).toEqual({ taskId: 'T-99', promptText: 'Prompt from task detail' })
      })
    })

    it('coalesces a burst of task-changed and session lifecycle refreshes', async () => {
      const App = (await import('./App.svelte')).default
      const stores = await import('./lib/stores')
      const ipc = await import('./lib/ipc')
      const { get } = await import('svelte/store')
      let resolveTasks!: () => void
      stores.activeProjectId.set('proj-1')

      render(App)

      await vi.waitFor(() => {
        expect(eventListeners.has('task-changed')).toBe(true)
        expect(eventListeners.has('implementation-failed')).toBe(true)
        expect(ipc.readActiveTasks).toHaveBeenCalled()
        expect(get(stores.isLoading)).toBe(false)
      })
      stores.activeProjectId.set('proj-1')

      vi.mocked(ipc.readActiveTasks).mockClear()
      vi.mocked(ipc.readActiveTasks).mockReturnValueOnce(new Promise((resolve) => {
        resolveTasks = () => resolve({ tasks: [], related: [] })
      }))

      const taskChanged = requireDefined(eventListeners.get('task-changed'), 'Expected task-changed listener')
      const implementationFailed = requireDefined(
        eventListeners.get('implementation-failed'),
        'Expected implementation-failed listener',
      )
      const refreshes = Array.from({ length: 10 }, (_, index) => Promise.all([
        taskChanged({ payload: { action: 'updated', task_id: `T-${index}` } }),
        implementationFailed({ payload: { task_id: `T-${index}`, error: 'failed' } }),
      ]))

      await vi.waitFor(() => {
        expect(ipc.readActiveTasks).toHaveBeenCalledOnce()
      })

      resolveTasks()
      await Promise.all(refreshes)

      expect(ipc.readActiveTasks).toHaveBeenCalledOnce()
    })
  })
})
