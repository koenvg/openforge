import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewSubmissionComment } from '../../lib/types'
import SendToAgentPanel from './SendToAgentPanel.svelte'


describe('SendToAgentPanel', () => {
  const inlineComments: ReviewSubmissionComment[] = [
    { path: 'src/task.ts', line: 12, side: 'RIGHT', body: 'task scoped feedback' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses task-scoped pending inline comments for the send affordance', () => {
    render(SendToAgentPanel, {
      props: {
        agentStatus: null,
        onSendToAgent: vi.fn(),
        onRefresh: vi.fn(),
        pendingInlineComments: inlineComments,
      },
    })

    expect(screen.getByText('1 inline comment')).toBeTruthy()
    expect(screen.getByText('Send to agent').closest('button')?.disabled).toBe(false)
  })

  it('keeps inline comments while previewing, then clears them on confirm', async () => {
    const onPendingInlineCommentsChange = vi.fn()
    const onSendToAgent = vi.fn()
    render(SendToAgentPanel, {
      props: {
        agentStatus: null,
        onSendToAgent,
        onRefresh: vi.fn(),
        pendingInlineComments: inlineComments,
        onPendingInlineCommentsChange,
      },
    })

    await fireEvent.click(screen.getByText('Send to agent'))
    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement

    expect(onPendingInlineCommentsChange).not.toHaveBeenCalled()
    expect(onSendToAgent).not.toHaveBeenCalled()
    expect(textarea.value).toContain('Please address the following review comments:')
    expect(textarea.value).toContain('task scoped feedback')
    expect(textarea.value).not.toContain('for task')

    await fireEvent.click(screen.getByTestId('confirm-send-prompt'))
    expect(onPendingInlineCommentsChange).toHaveBeenCalledWith([])
    expect(onSendToAgent).toHaveBeenCalledWith(textarea.value)
  })

  it('regenerates the prompt when toggling between Address and Analyze modes', async () => {
    const onSendToAgent = vi.fn()
    render(SendToAgentPanel, {
      props: {
        agentStatus: null,
        onSendToAgent,
        onRefresh: vi.fn(),
        pendingInlineComments: inlineComments,
      },
    })

    await fireEvent.click(screen.getByText('Send to agent'))
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
        agentStatus: null,
        onSendToAgent,
        onRefresh: vi.fn(),
        pendingInlineComments: inlineComments,
      },
    })

    await fireEvent.click(screen.getByText('Send to agent'))
    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'my edited prompt' } })
    await fireEvent.click(screen.getByTestId('confirm-send-prompt'))

    expect(onSendToAgent).toHaveBeenCalledWith('my edited prompt')
  })

  it('does not send when the dialog is cancelled', async () => {
    const onSendToAgent = vi.fn()
    const onPendingInlineCommentsChange = vi.fn()
    render(SendToAgentPanel, {
      props: {
        agentStatus: null,
        onSendToAgent,
        onRefresh: vi.fn(),
        pendingInlineComments: inlineComments,
        onPendingInlineCommentsChange,
      },
    })

    await fireEvent.click(screen.getByText('Send to agent'))
    await screen.findByRole('textbox')
    await fireEvent.click(screen.getByText('Cancel'))

    expect(onPendingInlineCommentsChange).not.toHaveBeenCalled()
    expect(onSendToAgent).not.toHaveBeenCalled()
  })
})
