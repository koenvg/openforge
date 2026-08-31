import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TERMINAL_VIEW_ID,
  baseTask,
  createTaskWorkspaceInfo,
  getTaskDetailViewTestDependencies,
  mockOnRunAction,
  resetTaskDetailViewTestState,
  secondaryTask,
} from './TaskDetailView.testUtils'

const { TaskDetailView, taskActiveView, taskRuntimeInfo } = getTaskDetailViewTestDependencies()

describe('TaskDetailView active-view persistence', () => {
  beforeEach(resetTaskDetailViewTestState)

  beforeEach(() => {
    taskActiveView.set(new Map())
  })

  it('preserves the runtime workspace and active terminal tab when workspace lookup fails', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockRejectedValue(new Error('workspace lookup failed'))
    taskRuntimeInfo.set(new Map([['T-42', { workspacePath: '/path/to/worktree' }]]))
    taskActiveView.set(new Map([['T-42', TERMINAL_VIEW_ID]]))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    await waitFor(() => expect(vi.mocked(getTaskWorkspace)).toHaveBeenCalledWith('T-42'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^terminal\b/i }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('false')
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('l key writes review to taskActiveView store for the task', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('review')).toBeTruthy())

    await fireEvent.keyDown(window, { key: 'l' })

    await waitFor(() => {
      expect(get(taskActiveView).get('T-42')).toBe('review')
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('h key writes agent to taskActiveView store for the task', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    taskActiveView.set(new Map([['T-42', 'review']]))
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByText('review')).toBeTruthy())

    await fireEvent.keyDown(window, { key: 'h' })

    await waitFor(() => {
      expect(get(taskActiveView).get('T-42')).toBe('agent')
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('restores legacy code mode from taskActiveView as the agent tab', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    taskActiveView.set(new Map([['T-42', 'code']]))
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('restores terminal mode and completes terminal activation without unhandled errors', async () => {
    const { getTaskWorkspace, spawnShellPty } = await import('../../lib/ipc')
    const { regularTerminalSessions } = await import('../../lib/terminalSessionService')
    const { acquire, attach, beginPtySpawn, getShellLifecycleState } = regularTerminalSessions
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
    vi.mocked(spawnShellPty).mockClear()
    vi.mocked(acquire).mockClear()
    vi.mocked(attach).mockClear()
    vi.mocked(beginPtySpawn).mockClear()

    taskActiveView.set(new Map([['T-42', TERMINAL_VIEW_ID]]))
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^terminal\b/i }).getAttribute('aria-pressed')).toBe('true')
      expect(acquire).toHaveBeenCalledWith('T-42-shell-0')
      expect(attach).toHaveBeenCalledWith(
        expect.objectContaining({ shellSessionKey: 'T-42-shell-0' }),
        expect.any(HTMLDivElement),
      )
      expect(spawnShellPty).toHaveBeenCalledWith('T-42', '/tmp/wt', 80, 24, 0, 'iterm2')
      expect(beginPtySpawn).toHaveBeenCalledWith(
        expect.objectContaining({ shellSessionKey: 'T-42-shell-0' }),
      )
      expect(getShellLifecycleState('T-42-shell-0').currentPtyInstance).toBe(1)
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('active tab persists per task via taskActiveView store', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    taskActiveView.set(new Map([['T-42', 'review']]))
    render(TaskDetailView, { props: { task: secondaryTask, onRunAction: mockOnRunAction } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('false')
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })
  it('falls back to agent tab when stored tab is terminal but no worktree', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)

    taskActiveView.set(new Map([['T-42', TERMINAL_VIEW_ID]]))
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    // No worktree means no view tabs render; the active view falls back to agent
    await waitFor(() => {
      expect(screen.getByText('Initial Prompt')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /^terminal\b/i })).toBeNull()
  })
})
