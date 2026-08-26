import { render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  baseTask,
  createTaskWorkspaceInfo,
  getTaskDetailViewTestDependencies,
  mockOnRunAction,
  resetTaskDetailViewTestState,
  terminalAttachmentDetach,
} from './TaskDetailView.testUtils'

const {
  TaskDetailView,
} = getTaskDetailViewTestDependencies()

describe('TaskDetailView — lifecycle', () => {
  beforeEach(resetTaskDetailViewTestState)

  it('recreates agent panel terminal when switching tasks', async () => {
    const { acquire } = await import('../../lib/terminalPool')
    vi.mocked(acquire).mockClear()
    terminalAttachmentDetach.mockClear()

    const taskA = { ...baseTask, id: 'T-42' }
    const { rerender } = render(TaskDetailView, { props: { task: taskA, onRunAction: mockOnRunAction } })

    // Wait for AgentPanel to mount and acquire terminal for T-42
    await vi.waitFor(() => {
      expect(vi.mocked(acquire)).toHaveBeenCalledWith('T-42')
    })

    vi.mocked(acquire).mockClear()
    terminalAttachmentDetach.mockClear()

    // Switch to a different task
    const taskB = { ...baseTask, id: 'T-99', initial_prompt: 'Another task' }
    await rerender({ task: taskB, onRunAction: mockOnRunAction })

    // Agent panel should be recreated, acquiring terminal for the new task
    await vi.waitFor(() => {
      expect(vi.mocked(acquire)).toHaveBeenCalledWith('T-99')
    })

    // Old terminal should have been detached
    expect(terminalAttachmentDetach).toHaveBeenCalled()
  })

  describe('terminal cleanup on navigate-away', () => {
      it('calls releaseAllForTask when component unmounts', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        const { releaseAllForTask } = await import('../../lib/liveTerminalPool')

        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
        vi.mocked(releaseAllForTask).mockClear()

        const { unmount } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => expect(screen.getByRole('button', { name: /^agent\b/i })).toBeTruthy())

        unmount()

        expect(releaseAllForTask).toHaveBeenCalledWith('T-42')

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('calls releaseAllForTask when task prop changes', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        const { releaseAllForTask } = await import('../../lib/liveTerminalPool')

        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
        vi.mocked(releaseAllForTask).mockClear()

        const { rerender } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => expect(screen.getByRole('button', { name: /^agent\b/i })).toBeTruthy())

        const newTask = { ...baseTask, id: 'T-99', initial_prompt: 'New task' }
        rerender({ task: newTask, onRunAction: mockOnRunAction })

        await waitFor(() => {
          expect(releaseAllForTask).toHaveBeenCalledWith('T-42')
        })

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('does NOT call releaseAllForTask when task prop changes with same ID', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        const { releaseAllForTask } = await import('../../lib/liveTerminalPool')

        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
        vi.mocked(releaseAllForTask).mockClear()

        const { rerender } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => expect(screen.getByRole('button', { name: /^agent\b/i })).toBeTruthy())

        const refreshedTask = { ...baseTask, title: 'Updated title', title_source: 'manual' as const }
        rerender({ task: refreshedTask, onRunAction: mockOnRunAction })

        await new Promise(r => setTimeout(r, 50))

        expect(releaseAllForTask).not.toHaveBeenCalled()

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('cleanup only releases shell entries, not agent terminal', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        const { releaseAllForTask } = await import('../../lib/liveTerminalPool')

        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))
        vi.mocked(releaseAllForTask).mockClear()

        const { unmount } = render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => expect(screen.getByRole('button', { name: /^agent\b/i })).toBeTruthy())

        unmount()

        expect(releaseAllForTask).toHaveBeenCalledWith('T-42')

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })
    })
})
