import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import {
  baseTask,
  createTaskWorkspaceInfo,
  getTaskDetailViewTestDependencies,
  mockOnRunAction,
  resetTaskDetailViewTestState,
} from './TaskDetailView.testUtils'
import { activeSessions } from '../../lib/stores'
import { createAgentSession } from './agentSession.testFixtures'

const { TaskDetailView, taskActiveView } = getTaskDetailViewTestDependencies()

describe('TaskDetailView unread Agent output acknowledgement', () => {
  beforeEach(() => {
    resetTaskDetailViewTestState()
    activeSessions.set(new Map())
    vi.clearAllMocks()
  })

  it('keeps output unread on a restored hidden pane and acknowledges after Agent is selected', async () => {
    const { getTaskWorkspace, markAgentOutputViewed } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt' }))
    activeSessions.set(new Map([[baseTask.id, createAgentSession({
      ticket_id: baseTask.id,
      status: 'completed',
      output_revision: 1,
      viewed_output_revision: 0,
    })]]))
    taskActiveView.set(new Map([[baseTask.id, 'review']]))

    render(TaskDetailView, {
      props: { task: baseTask, onRunAction: mockOnRunAction, windowFocused: true },
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true')
    })
    expect(screen.getByRole('button', { name: /agent.*unread agent output/i })).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(markAgentOutputViewed).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('button', { name: /^agent\b/i }))

    await waitFor(() => {
      expect(markAgentOutputViewed).toHaveBeenCalledWith(baseTask.id, 'ses-1', 1)
      expect(screen.queryByTestId('agent-unread-marker')).toBeNull()
    })
  })

  it('waits for the application window to regain focused visibility', async () => {
    const { markAgentOutputViewed } = await import('../../lib/ipc')
    activeSessions.set(new Map([[baseTask.id, createAgentSession({
      ticket_id: baseTask.id,
      status: 'failed',
      output_revision: 2,
      viewed_output_revision: 1,
    })]]))

    const view = render(TaskDetailView, {
      props: { task: baseTask, onRunAction: mockOnRunAction, windowFocused: false },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(markAgentOutputViewed).not.toHaveBeenCalled()

    await view.rerender({ task: baseTask, onRunAction: mockOnRunAction, windowFocused: true })

    await waitFor(() => {
      expect(markAgentOutputViewed).toHaveBeenCalledWith(baseTask.id, 'ses-1', 2)
    })
  })

  it('updates the matching Agent Session and refreshes Task Attention after acknowledgement', async () => {
    const { markAgentOutputViewed } = await import('../../lib/ipc')
    const onProjectAttentionChanged = vi.fn().mockResolvedValue(undefined)
    activeSessions.set(new Map([[baseTask.id, createAgentSession({
      ticket_id: baseTask.id,
      status: 'completed',
      output_revision: 1,
      viewed_output_revision: 0,
    })]]))

    render(TaskDetailView, {
      props: {
        task: baseTask,
        onRunAction: mockOnRunAction,
        onProjectAttentionChanged,
        windowFocused: true,
      },
    })

    await waitFor(() => {
      expect(markAgentOutputViewed).toHaveBeenCalledWith(baseTask.id, 'ses-1', 1)
      expect(onProjectAttentionChanged).toHaveBeenCalledOnce()
    })
    expect(get(activeSessions).get(baseTask.id)?.viewed_output_revision).toBe(1)
  })

  it('does not let an older acknowledgement mutate a newer visible revision', async () => {
    const { markAgentOutputViewed } = await import('../../lib/ipc')
    let resolveOlder!: (changed: boolean) => void
    vi.mocked(markAgentOutputViewed).mockImplementationOnce(() => (
      new Promise<boolean>((resolve) => { resolveOlder = resolve })
    ))
    const onProjectAttentionChanged = vi.fn().mockResolvedValue(undefined)
    const olderSession = createAgentSession({
      ticket_id: baseTask.id,
      status: 'completed',
      output_revision: 1,
      viewed_output_revision: 0,
    })
    activeSessions.set(new Map([[baseTask.id, olderSession]]))

    const view = render(TaskDetailView, {
      props: {
        task: baseTask,
        onRunAction: mockOnRunAction,
        onProjectAttentionChanged,
        windowFocused: true,
      },
    })
    await waitFor(() => expect(markAgentOutputViewed).toHaveBeenCalledWith(baseTask.id, 'ses-1', 1))
    await view.rerender({
      task: baseTask,
      onRunAction: mockOnRunAction,
      onProjectAttentionChanged,
      windowFocused: false,
    })
    activeSessions.set(new Map([[baseTask.id, {
      ...olderSession,
      output_revision: 2,
      viewed_output_revision: 0,
    }]]))

    resolveOlder(true)

    await waitFor(() => expect(onProjectAttentionChanged).toHaveBeenCalledOnce())
    expect(get(activeSessions).get(baseTask.id)).toMatchObject({
      output_revision: 2,
      viewed_output_revision: 0,
    })
  })
})
