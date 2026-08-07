import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewSubmissionComment } from '../../lib/types'
import { selfReviewStateByTask } from '../../lib/taskScopedSelfReviewState'
import SendToAgentPanel from './SendToAgentPanel.svelte'

vi.mock('../../lib/ipc', () => ({
  archiveSelfReviewComments: vi.fn().mockResolvedValue(undefined),
  getActiveSelfReviewComments: vi.fn().mockResolvedValue([]),
  getArchivedSelfReviewComments: vi.fn().mockResolvedValue([]),
}))

describe('SendToAgentPanel', () => {
  const inlineComments: ReviewSubmissionComment[] = [
    { path: 'src/task.ts', line: 12, side: 'RIGHT', body: 'task scoped feedback' },
  ]

  beforeEach(() => {
    selfReviewStateByTask.set(new Map())
    vi.clearAllMocks()
  })

  it('uses task-scoped pending inline comments for the send affordance', () => {
    render(SendToAgentPanel, {
      props: {
        taskId: 'task-1',
        agentStatus: null,
        onSendToAgent: vi.fn(),
        onRefresh: vi.fn(),
        pendingInlineComments: inlineComments,
      },
    })

    expect(screen.getByText('1 inline comment')).toBeTruthy()
    expect(screen.getByText('→ Send to Agent').closest('button')?.disabled).toBe(false)
  })

  it('archives inline comments when opening the prompt dialog, then sends on confirm', async () => {
    const onPendingInlineCommentsChange = vi.fn()
    const onSendToAgent = vi.fn()
    render(SendToAgentPanel, {
      props: {
        taskId: 'task-1',
        agentStatus: null,
        onSendToAgent,
        onRefresh: vi.fn(),
        pendingInlineComments: inlineComments,
        onPendingInlineCommentsChange,
      },
    })

    // Clicking the panel button archives (current timing) and opens the dialog,
    // but does NOT dispatch to the agent yet.
    await fireEvent.click(screen.getByText('→ Send to Agent'))
    await waitFor(() => {
      expect(onPendingInlineCommentsChange).toHaveBeenCalledWith([])
    })
    expect(onSendToAgent).not.toHaveBeenCalled()

    // The dialog shows the compiled prompt (Address mode by default) with the
    // comment content — and NOT the task's initial prompt.
    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    expect(textarea.value).toContain('Please address the following review comments:')
    expect(textarea.value).toContain('task scoped feedback')
    expect(textarea.value).not.toContain('for task')

    // Confirming dispatches the prompt.
    await fireEvent.click(screen.getByTestId('confirm-send-prompt'))
    expect(onSendToAgent).toHaveBeenCalledWith(textarea.value)
  })

  it('regenerates the prompt when toggling between Address and Analyze modes', async () => {
    const onSendToAgent = vi.fn()
    render(SendToAgentPanel, {
      props: {
        taskId: 'task-1',
        agentStatus: null,
        onSendToAgent,
        onRefresh: vi.fn(),
        pendingInlineComments: inlineComments,
      },
    })

    await fireEvent.click(screen.getByText('→ Send to Agent'))
    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement

    // Default is Address.
    expect(textarea.value).toContain('Please address the following review comments:')
    expect(textarea.value).not.toContain('Please analyze')

    // Toggle to Analyze regenerates the prompt.
    await fireEvent.click(screen.getByText('Analyze'))
    expect(textarea.value).toContain('Please analyze the following review comments')
    expect(textarea.value).not.toContain('Please address the following review comments:')

    // Sending uses the current (Analyze) prompt.
    await fireEvent.click(screen.getByTestId('confirm-send-prompt'))
    expect(onSendToAgent).toHaveBeenCalledWith(expect.stringContaining('Please analyze'))
  })

  it('sends the edited prompt text, not the original', async () => {
    const onSendToAgent = vi.fn()
    render(SendToAgentPanel, {
      props: {
        taskId: 'task-1',
        agentStatus: null,
        onSendToAgent,
        onRefresh: vi.fn(),
        pendingInlineComments: inlineComments,
      },
    })

    await fireEvent.click(screen.getByText('→ Send to Agent'))
    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'my edited prompt' } })
    await fireEvent.click(screen.getByTestId('confirm-send-prompt'))

    expect(onSendToAgent).toHaveBeenCalledWith('my edited prompt')
  })

  it('does not send when the dialog is cancelled', async () => {
    const onSendToAgent = vi.fn()
    render(SendToAgentPanel, {
      props: {
        taskId: 'task-1',
        agentStatus: null,
        onSendToAgent,
        onRefresh: vi.fn(),
        pendingInlineComments: inlineComments,
      },
    })

    await fireEvent.click(screen.getByText('→ Send to Agent'))
    await screen.findByRole('textbox')
    await fireEvent.click(screen.getByText('Cancel'))

    expect(onSendToAgent).not.toHaveBeenCalled()
  })
})
