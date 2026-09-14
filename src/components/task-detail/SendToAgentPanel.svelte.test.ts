import { flushSync } from 'svelte'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelfReviewTaskState } from '../../lib/taskScopedSelfReviewState'
import type { PrComment, ReviewSubmissionComment } from '../../lib/types'
import { createSelfReviewCommentController } from './selfReviewCommentController.svelte'
import SendToAgentPanel from './SendToAgentPanel.svelte'

const inlineComments: ReviewSubmissionComment[] = [
  { path: 'src/task.ts', line: 12, side: 'RIGHT', body: 'task scoped feedback' },
]
const rootCleanups: Array<() => void> = []

function setup({
  inline = inlineComments,
  pr = [],
  agentStatus = null,
  onSendToAgent = vi.fn(),
}: {
  inline?: ReviewSubmissionComment[]
  pr?: PrComment[]
  agentStatus?: string | null
  onSendToAgent?: (prompt: string) => void
} = {}) {
  let state = $state<SelfReviewTaskState>({
    diffFiles: [], pendingInlineComments: inline, inlineCommentDrafts: new Map(),
  })
  let feedback!: ReturnType<typeof createSelfReviewCommentController>
  rootCleanups.push($effect.root(() => {
    feedback = createSelfReviewCommentController({
      getTaskId: () => 'task-1', getState: () => state, getPrComments: () => pr,
      getComparisonFilenames: () => new Set(),
      setPendingComments: (_taskId, comments) => { state = { ...state, pendingInlineComments: comments } },
    })
  }))
  flushSync()
  feedback.commentSelection.selectAll()
  const view = render(SendToAgentPanel, { agentStatus, onSendToAgent, onRefresh: vi.fn(), feedback })
  return { view, feedback, onSendToAgent }
}

async function openPreview() {
  await fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }))
  return screen.getByRole('textbox') as HTMLTextAreaElement
}

afterEach(() => {
  while (rootCleanups.length) rootCleanups.pop()?.()
})

describe('SendToAgentPanel', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('success confirmation timer', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => {
      vi.clearAllTimers()
      vi.useRealTimers()
    })

    it('keeps the latest confirmation visible for its full three seconds', async () => {
      const { feedback } = setup()
      await openPreview()
      await fireEvent.click(screen.getByTestId('confirm-send-prompt'))
      expect(screen.queryByText('Feedback sent to agent!')).not.toBeNull()

      await vi.advanceTimersByTimeAsync(2000)
      flushSync(() => feedback.handlePendingInlineCommentsChange(inlineComments))
      await openPreview()
      await fireEvent.click(screen.getByTestId('confirm-send-prompt'))
      await vi.advanceTimersByTimeAsync(1000)
      expect(screen.queryByText('Feedback sent to agent!')).not.toBeNull()
      await vi.advanceTimersByTimeAsync(1999)
      expect(screen.queryByText('Feedback sent to agent!')).not.toBeNull()
      await vi.advanceTimersByTimeAsync(1)
      expect(screen.queryByText('Feedback sent to agent!')).toBeNull()
    })

    it('cancels the pending confirmation timer on destruction', async () => {
      const { view } = setup()
      const initialTimerCount = vi.getTimerCount()
      await openPreview()
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

  it('keeps feedback through preview and dispatch, then reconciles on confirm', async () => {
    const onSendToAgent = vi.fn(() => {
      expect(feedback.pendingInlineComments).toEqual(inlineComments)
    })
    const { feedback } = setup({ onSendToAgent })
    const textarea = await openPreview()
    expect(feedback.pendingInlineComments).toEqual(inlineComments)
    expect(onSendToAgent).not.toHaveBeenCalled()
    expect(textarea.value).toContain('Please address the following review comments:')
    expect(textarea.value).toContain('task scoped feedback')
    expect(textarea.value).not.toContain('for task')
    const prompt = textarea.value
    await fireEvent.click(screen.getByTestId('confirm-send-prompt'))
    expect(onSendToAgent).toHaveBeenCalledWith(prompt)
    expect(feedback.pendingInlineComments).toEqual([])
    expect((screen.getByRole('button', { name: 'Send feedback (0)' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('regenerates modes from the capture, replacing manual edits', async () => {
    const { onSendToAgent, feedback } = setup()
    const textarea = await openPreview()
    expect(textarea.value).toContain('Please address the following review comments:')
    await fireEvent.input(textarea, { target: { value: 'manual edits' } })
    feedback.handlePendingInlineCommentsChange([{ ...inlineComments[0], body: 'later feedback' }])
    await fireEvent.click(screen.getByRole('button', { name: 'Analyze' }))
    expect(textarea.value).toContain('Please analyze the following review comments')
    expect(textarea.value).toContain('task scoped feedback')
    expect(textarea.value).not.toContain('manual edits')
    expect(textarea.value).not.toContain('later feedback')
    await fireEvent.click(screen.getByTestId('confirm-send-prompt'))
    expect(onSendToAgent).toHaveBeenCalledWith(expect.stringContaining('Please analyze'))
  })

  it('sends the edited prompt text, not the original', async () => {
    const { onSendToAgent } = setup()
    const textarea = await openPreview()
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
    try {
      const { onSendToAgent } = setup()
      const textarea = await openPreview()
      await fireEvent.click(screen.getByRole('button', { name: mode }))
      await fireEvent.input(textarea, { target: { value: '  edited feedback\nkeep this newline  ' } })
      const focused = target === 'textbox' ? textarea : screen.getByRole('button', { name: mode })
      focused.focus()
      await fireEvent.keyDown(focused, { key: 'Enter', ...modifier })
      expect(onSendToAgent).toHaveBeenCalledExactlyOnceWith('  edited feedback\nkeep this newline  ')
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
      setup()
      await openPreview()
      expect(screen.getByRole('button', { name: 'Send to agent' }).textContent).toContain(hint)
    } finally {
      platformSpy.mockRestore()
    }
  })

  describe('submit shortcut safeguards', () => {
    beforeEach(() => { vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel') })
    afterEach(() => { vi.restoreAllMocks() })

    it.each([
      { name: 'composition', event: { metaKey: true, isComposing: true } },
      { name: 'held key', event: { metaKey: true, repeat: true } },
      { name: 'extra Alt', event: { metaKey: true, altKey: true } },
      { name: 'extra Shift', event: { metaKey: true, shiftKey: true } },
      { name: 'plain Enter', event: {} },
      { name: 'Shift+Enter', event: { shiftKey: true } },
    ])('does not submit for $name', async ({ event }) => {
      const { onSendToAgent } = setup()
      const textarea = await openPreview()
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
      const { view, onSendToAgent, feedback } = setup()
      const textarea = await openPreview()
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
      expect(feedback.pendingInlineComments).toEqual(inlineComments)
      expect(screen.queryByRole('dialog')).not.toBeNull()
      expect(textarea.value).toBe(draft)
      expect((screen.getByTestId('confirm-send-prompt') as HTMLButtonElement).disabled).toBe(true)
    })

    it('does not send outside the dialog or after it closes', async () => {
      const { onSendToAgent } = setup()
      await fireEvent.keyDown(document.body, { key: 'Enter', metaKey: true })
      await openPreview()
      await fireEvent.keyDown(document.body, { key: 'Enter', metaKey: true })
      await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      await fireEvent.keyDown(document.body, { key: 'Enter', metaKey: true })
      expect(onSendToAgent).not.toHaveBeenCalled()
    })
  })

  it('cancels without changing feedback and captures fresh feedback when reopened', async () => {
    const { feedback, onSendToAgent } = setup()
    await openPreview()
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSendToAgent).not.toHaveBeenCalled()
    expect(feedback.pendingInlineComments).toEqual(inlineComments)
    feedback.handlePendingInlineCommentsChange([{ ...inlineComments[0], body: 'fresh feedback' }])
    const textarea = await openPreview()
    expect(textarea.value).toContain('fresh feedback')
    expect(textarea.value).not.toContain('task scoped feedback')
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
    setup({ agentStatus: status, inline: inline ? inlineComments : [], pr: pr ? [comment] : [] })
    const button = screen.getByRole('button', { name: label }) as HTMLButtonElement
    expect(button.disabled).toBe(disabled)
    expect(button.title).toBe(reason)
  })

  it('presents refresh as an icon-only button with a tooltip', () => {
    setup({ inline: [] })
    const refresh = screen.getByRole('button', { name: 'Refresh diff' })
    expect(refresh.hasAttribute('title')).toBe(false)
    expect(refresh.textContent?.trim()).toBe('')
  })

  it('does not confirm a preview if the agent becomes busy', async () => {
    const { view, onSendToAgent } = setup()
    await openPreview()
    await view.rerender({ agentStatus: 'running' })
    const confirm = screen.getByTestId('confirm-send-prompt') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await fireEvent.click(confirm)
    expect(onSendToAgent).not.toHaveBeenCalled()
  })
})
