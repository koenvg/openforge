import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrComment, ReviewSubmissionComment } from '../../lib/types'
import SendToAgentPanel from './SendToAgentPanel.svelte'


describe('SendToAgentPanel', () => {
  const inlineComments: ReviewSubmissionComment[] = [
    { path: 'src/task.ts', line: 12, side: 'RIGHT', body: 'task scoped feedback' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('success confirmation timer', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.clearAllTimers()
      vi.useRealTimers()
    })

    it('keeps the latest confirmation visible for its full three seconds', async () => {
      render(SendToAgentPanel, {
        agentStatus: null, onSendToAgent: vi.fn(), onRefresh: vi.fn(),
        pendingInlineComments: inlineComments,
      })
      await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
      await fireEvent.click(screen.getByTestId('confirm-send-prompt'))
      expect(screen.queryByText('Feedback sent to agent!')).not.toBeNull()

      await vi.advanceTimersByTimeAsync(2000)
      await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
      await fireEvent.click(screen.getByTestId('confirm-send-prompt'))

      await vi.advanceTimersByTimeAsync(1000)
      expect(screen.queryByText('Feedback sent to agent!')).not.toBeNull()
      await vi.advanceTimersByTimeAsync(1999)
      expect(screen.queryByText('Feedback sent to agent!')).not.toBeNull()
      await vi.advanceTimersByTimeAsync(1)
      expect(screen.queryByText('Feedback sent to agent!')).toBeNull()
    })

    it('cancels the pending confirmation timer on destruction', async () => {
      const view = render(SendToAgentPanel, {
        agentStatus: null, onSendToAgent: vi.fn(), onRefresh: vi.fn(),
        pendingInlineComments: inlineComments,
      })
      const initialTimerCount = vi.getTimerCount()
      await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
      await fireEvent.click(screen.getByTestId('confirm-send-prompt'))
      expect(screen.queryByText('Feedback sent to agent!')).not.toBeNull()
      await vi.advanceTimersByTimeAsync(1000)
      expect(vi.getTimerCount()).toBe(initialTimerCount + 1)

      view.unmount()

      expect(vi.getTimerCount()).toBe(initialTimerCount)
      await vi.advanceTimersByTimeAsync(3000)
      expect(screen.queryByText('Feedback sent to agent!')).toBeNull()
    })
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

    expect((screen.getByRole('button', { name: 'Send feedback (1)' }) as HTMLButtonElement).disabled).toBe(false)
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

    await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
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

    await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
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

    await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'my edited prompt' } })
    await fireEvent.click(screen.getByTestId('confirm-send-prompt'))

    expect(onSendToAgent).toHaveBeenCalledWith('my edited prompt')
  })

  it.each([
    { platform: 'MacIntel', modifier: { metaKey: true }, mode: 'Address', target: 'textbox' },
    { platform: 'Win32', modifier: { ctrlKey: true }, mode: 'Analyze', target: 'button' },
    { platform: 'Linux x86_64', modifier: { ctrlKey: true }, mode: 'Address', target: 'textbox' },
  ])('submits the edited $mode draft on $platform from a $target', async ({ platform, modifier, mode, target }) => {
    const platformSpy = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue(platform)
    const onSendToAgent = vi.fn()
    const onPendingInlineCommentsChange = vi.fn()
    try {
      render(SendToAgentPanel, {
        agentStatus: null, onSendToAgent, onRefresh: vi.fn(),
        pendingInlineComments: inlineComments, onPendingInlineCommentsChange,
      })
      await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
      await fireEvent.click(screen.getByRole('button', { name: mode }))
      const textarea = screen.getByRole('textbox')
      await fireEvent.input(textarea, { target: { value: '  edited feedback\nkeep this newline  ' } })
      const focused = target === 'textbox' ? textarea : screen.getByRole('button', { name: mode })
      focused.focus()
      await fireEvent.keyDown(focused, { key: 'Enter', ...modifier })

      expect(onSendToAgent).toHaveBeenCalledExactlyOnceWith('  edited feedback\nkeep this newline  ')
      expect(onPendingInlineCommentsChange).toHaveBeenCalledExactlyOnceWith([])
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      platformSpy.mockRestore()
    }
  })

  it.each([
    { platform: 'MacIntel', hint: '⌘↵' },
    { platform: 'Win32', hint: 'Ctrl+Enter' },
    { platform: 'Linux x86_64', hint: 'Ctrl+Enter' },
  ])('shows the submit shortcut for $platform', async ({ platform, hint }) => {
    const platformSpy = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue(platform)
    try {
      render(SendToAgentPanel, { agentStatus: null, onSendToAgent: vi.fn(), onRefresh: vi.fn(), pendingInlineComments: inlineComments })
      await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
      expect(screen.getByRole('button', { name: 'Send to agent' }).textContent).toContain(hint)
    } finally {
      platformSpy.mockRestore()
    }
  })

  describe('submit shortcut safeguards', () => {
    beforeEach(() => {
      vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel')
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it.each([
      { name: 'composition', event: { metaKey: true, isComposing: true } },
      { name: 'held key', event: { metaKey: true, repeat: true } },
      { name: 'extra Alt', event: { metaKey: true, altKey: true } },
      { name: 'extra Shift', event: { metaKey: true, shiftKey: true } },
      { name: 'plain Enter', event: {} },
      { name: 'Shift+Enter', event: { shiftKey: true } },
    ])('does not submit for $name', async ({ event }) => {
      const onSendToAgent = vi.fn()
      render(SendToAgentPanel, { agentStatus: null, onSendToAgent, onRefresh: vi.fn(), pendingInlineComments: inlineComments })
      await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
      const textarea = screen.getByRole('textbox')
      textarea.focus()
      const keydown = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...event })
      await fireEvent(textarea, keydown)

      expect(onSendToAgent).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeNull()
      expect(keydown.defaultPrevented).toBe(false)
    })

    it.each([
      { name: 'empty draft', draft: '', status: null },
      { name: 'whitespace draft', draft: ' \n  ', status: null },
      { name: 'running agent', draft: 'keep this draft', status: 'running' },
      { name: 'paused agent', draft: 'keep this draft', status: 'paused' },
    ])('consumes the shortcut without sending for $name', async ({ draft, status }) => {
      const onSendToAgent = vi.fn()
      const onPendingInlineCommentsChange = vi.fn()
      const view = render(SendToAgentPanel, {
        agentStatus: null, onSendToAgent, onRefresh: vi.fn(),
        pendingInlineComments: inlineComments, onPendingInlineCommentsChange,
      })
      await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
      await fireEvent.input(textarea, { target: { value: draft } })
      await view.rerender({ agentStatus: status })
      textarea.focus()
      const keydown = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })
      const outerShortcut = vi.fn()
      document.addEventListener('keydown', outerShortcut)
      try {
        await fireEvent(textarea, keydown)
        expect(outerShortcut).not.toHaveBeenCalled()
      } finally {
        document.removeEventListener('keydown', outerShortcut)
      }

      expect(keydown.defaultPrevented).toBe(true)
      expect(onSendToAgent).not.toHaveBeenCalled()
      expect(onPendingInlineCommentsChange).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeNull()
      expect(textarea.value).toBe(draft)
      expect((screen.getByTestId('confirm-send-prompt') as HTMLButtonElement).disabled).toBe(true)
    })

    it('does not send outside the dialog or after it closes', async () => {
      const onSendToAgent = vi.fn()
      render(SendToAgentPanel, { agentStatus: null, onSendToAgent, onRefresh: vi.fn(), pendingInlineComments: inlineComments })
      await fireEvent.keyDown(document.body, { key: 'Enter', metaKey: true })
      await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
      await fireEvent.keyDown(document.body, { key: 'Enter', metaKey: true })
      await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      await fireEvent.keyDown(document.body, { key: 'Enter', metaKey: true })

      expect(onSendToAgent).not.toHaveBeenCalled()
    })
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

    await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
    await screen.findByRole('textbox')
    await fireEvent.click(screen.getByText('Cancel'))

    expect(onPendingInlineCommentsChange).not.toHaveBeenCalled()
    expect(onSendToAgent).not.toHaveBeenCalled()
  })

  it('preserves inline feedback added or edited after the preview opened', async () => {
    const onPendingInlineCommentsChange = vi.fn()
    const onSendToAgent = vi.fn()
    const original = { ...inlineComments[0] }
    const view = render(SendToAgentPanel, {
      agentStatus: null, onSendToAgent, onRefresh: vi.fn(),
      pendingInlineComments: [original], onPendingInlineCommentsChange,
    })
    await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
    const edited = { ...original, body: 'updated feedback' }
    const added: ReviewSubmissionComment = { path: 'src/new.ts', line: 4, side: 'RIGHT', body: 'new feedback' }
    await view.rerender({ pendingInlineComments: [edited, added] })
    await fireEvent.click(screen.getByTestId('confirm-send-prompt'))
    expect(onSendToAgent).toHaveBeenCalledWith(expect.stringContaining(original.body))
    expect(onSendToAgent).not.toHaveBeenCalledWith(expect.stringContaining(added.body))
    expect(onPendingInlineCommentsChange).toHaveBeenCalledWith([edited, added])
  })

  it('preserves an additional identical inline comment added after capture', async () => {
    const original = inlineComments[0]
    const onPendingInlineCommentsChange = vi.fn()
    const view = render(SendToAgentPanel, {
      agentStatus: null, onSendToAgent: vi.fn(), onRefresh: vi.fn(),
      pendingInlineComments: [original], onPendingInlineCommentsChange,
    })
    await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
    await view.rerender({ pendingInlineComments: [original, { ...original }] })
    await fireEvent.click(screen.getByTestId('confirm-send-prompt'))
    expect(onPendingInlineCommentsChange).toHaveBeenCalledWith([original])
  })

  it.each([false, true])('only completes unchanged captured GitHub selections, edited=%s', async (edited) => {
    const original: PrComment = { id: 1, pr_id: 1, author: 'alice', body: 'original review', comment_type: 'review_comment', file_path: 'src/task.ts', line_number: 12, addressed: 0, outdated: 0, created_at: 1000 }
    const onSendComplete = vi.fn()
    const onSendToAgent = vi.fn()
    const view = render(SendToAgentPanel, { agentStatus: null, onSendToAgent, onRefresh: vi.fn(), selectedPrComments: [original], onSendComplete })
    await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
    const current = edited ? { ...original, body: 'updated review' } : original
    const added = { ...original, id: 2, body: 'newly selected review' }
    await view.rerender({ selectedPrComments: [current, added] })
    await fireEvent.click(screen.getByTestId('confirm-send-prompt'))
    expect(onSendToAgent).toHaveBeenCalledWith(expect.stringContaining(original.body))
    expect(onSendToAgent).not.toHaveBeenCalledWith(expect.stringContaining(added.body))
    expect(onSendComplete).toHaveBeenCalledWith(edited ? [] : [original.id])
  })

  it.each([
    { inline: 0, pr: 0, status: null, label: 'Send feedback (0)', disabled: true, reason: 'Add comments before sending' },
    { inline: 1, pr: 0, status: null, label: 'Send feedback (1)', disabled: false, reason: 'Review and send feedback to agent' },
    { inline: 0, pr: 1, status: null, label: 'Send feedback (1)', disabled: false, reason: 'Review and send feedback to agent' },
    { inline: 1, pr: 1, status: null, label: 'Send feedback (2)', disabled: false, reason: 'Review and send feedback to agent' },
    { inline: 1, pr: 1, status: 'running', label: 'Send feedback (2)', disabled: true, reason: 'Agent is currently running' },
    { inline: 1, pr: 1, status: 'paused', label: 'Send feedback (2)', disabled: true, reason: 'Agent is currently paused' },
  ])('reports feedback eligibility for $label with agent $status', ({ inline, pr, status, label, disabled, reason }) => {
    const comment: PrComment = { id: 1, pr_id: 1, author: 'alice', body: 'review', comment_type: 'review_comment', file_path: 'src/task.ts', line_number: 12, addressed: 0, outdated: 0, created_at: 1000 }
    render(SendToAgentPanel, { agentStatus: status, onSendToAgent: vi.fn(), onRefresh: vi.fn(), pendingInlineComments: inline ? inlineComments : [], selectedPrComments: pr ? [comment] : [] })
    const button = screen.getByRole('button', { name: label }) as HTMLButtonElement
    expect(button.disabled).toBe(disabled)
    expect(button.title).toBe(reason)
  })

  it('presents refresh as an icon-only button with a tooltip', () => {
    render(SendToAgentPanel, { agentStatus: null, onSendToAgent: vi.fn(), onRefresh: vi.fn() })

    const refresh = screen.getByRole('button', { name: 'Refresh diff' })
    expect(refresh.getAttribute('title')).toBe('Refresh diff')
    expect(refresh.textContent?.trim()).toBe('')
  })

  it('does not confirm a preview if the agent becomes busy', async () => {
    const onSendToAgent = vi.fn()
    const view = render(SendToAgentPanel, { agentStatus: null, onSendToAgent, onRefresh: vi.fn(), pendingInlineComments: inlineComments })
    await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
    await view.rerender({ agentStatus: 'running' })
    const confirm = screen.getByTestId('confirm-send-prompt') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await fireEvent.click(confirm)
    expect(onSendToAgent).not.toHaveBeenCalled()
  })
})
