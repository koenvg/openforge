import { baseDiff, baseTask, renderSelfReviewView, setupSelfReviewViewTestSuite } from './SelfReviewView.testUtils'
import { fireEvent, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import { getCommitDiff, getTaskCommits, getTaskDiff } from '../../lib/ipc'
import { setPendingSelfReviewComments, getPendingSelfReviewComments } from '../../lib/taskScopedSelfReviewState'

setupSelfReviewViewTestSuite()

describe('Self Review shared panel', () => {
  it('reopens the changed-files panel after collapse and starts a new task with changed files', async () => {
    vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])
    const view = renderSelfReviewView()
    const files = await screen.findByRole('tab', { name: 'Changed files' })
    await screen.findByRole('button', { name: 'Hide file tree' })
    expect(files.getAttribute('aria-selected')).toBe('true')
    await fireEvent.click(screen.getByRole('button', { name: 'Hide file tree' }))
    expect(screen.queryByRole('tablist', { name: 'Review navigation' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Show file tree' }))
    expect(screen.getByRole('tab', { name: 'Changed files' }).getAttribute('aria-selected')).toBe('true')
    await view.rerender({ task: { ...baseTask, id: 'task-2' } })
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Changed files' }).getAttribute('aria-selected')).toBe('true')
    })
  })

  it('does not carry a changed-file filter into another task', async () => {
    vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])
    const view = renderSelfReviewView()
    const filter = await screen.findByRole('searchbox', { name: 'Filter changed files' })
    await fireEvent.input(filter, { target: { value: 'main.rs' } })
    await view.rerender({ task: { ...baseTask, id: 'task-2' } })
    await waitFor(() => {
      expect((screen.getByRole('searchbox', { name: 'Filter changed files' }) as HTMLInputElement).value).toBe('')
    })
  })

  it('retains the changed-file filter when returning from GitHub comments', async () => {
    vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])
    renderSelfReviewView()
    const filter = await screen.findByRole('searchbox', { name: 'Filter changed files' })
    await fireEvent.input(filter, { target: { value: 'main.rs' } })
    await fireEvent.click(screen.getByRole('tab', { name: 'GitHub comments' }))
    await fireEvent.click(screen.getByRole('tab', { name: 'Changed files' }))
    expect((screen.getByRole('searchbox', { name: 'Filter changed files' }) as HTMLInputElement).value).toBe('main.rs')
  })

  it.each(['loading', 'empty', 'failure', 'populated'])('keeps feedback available with a %s diff without losing newer feedback', async (state) => {
    if (state === 'loading') vi.mocked(getTaskDiff).mockReturnValue(new Promise(() => {}))
    else if (state === 'failure') vi.mocked(getTaskDiff).mockRejectedValue(new Error('Diff unavailable'))
    else vi.mocked(getTaskDiff).mockResolvedValue(state === 'empty' ? [] : [baseDiff])
    const original = { path: 'src/main.rs', line: 2, side: 'RIGHT' as const, body: 'captured feedback' }
    const added = { ...original, line: 3, body: 'newer feedback' }
    setPendingSelfReviewComments(baseTask.id, [original])
    const onSendToAgent = vi.fn()
    renderSelfReviewView({ onSendToAgent })
    if (state === 'populated') {
      await screen.findByRole('button', { name: /Collapse diff for src\/main\.rs/ })
      await fireEvent.click(await screen.findByRole('button', { name: 'Hide file tree' }))
    }
    const send = await screen.findByRole('button', { name: 'Send feedback (1)' })
    await fireEvent.click(send)
    await screen.findByRole('dialog', { name: 'Review the prompt before sending to the agent' })
    setPendingSelfReviewComments(baseTask.id, [original, added])
    await fireEvent.click(screen.getByRole('button', { name: 'Send to agent' }))
    expect(onSendToAgent).toHaveBeenCalledWith(expect.stringContaining(original.body))
    expect(getPendingSelfReviewComments(baseTask.id)).toEqual([added])
    if (state === 'populated') expect(screen.getByRole('button', { name: 'Show file tree' })).toBeTruthy()
  })

  it.each([false, true])('opens and focuses changed files from the diff, collapsed=%s', async (collapsed) => {
    vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])
    renderSelfReviewView()
    const scrollArea = await screen.findByRole('region', { name: 'Diff scroll area' })
    if (collapsed) await fireEvent.click(screen.getByRole('button', { name: 'Hide file tree' }))
    else await fireEvent.click(screen.getByRole('tab', { name: 'GitHub comments' }))
    await fireEvent.keyDown(scrollArea, { key: 'Tab', shiftKey: true })
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Changed files' }).getAttribute('aria-selected')).toBe('true')
      expect(document.activeElement).toBe(screen.getByRole('tree', { name: 'Changed files' }))
    })
  })

  it.each(['scope', 'commit'])('preserves %s, reviewed files, filters, comments, and scroll across tabs', async (mode) => {
    const commit = { sha: 'history', short_sha: 'hist', message: 'Historical change', author: 'dev', date: '2025-01-01' }
    vi.mocked(getTaskDiff).mockResolvedValue([baseDiff])
    vi.mocked(getTaskCommits).mockResolvedValue([commit])
    vi.mocked(getCommitDiff).mockResolvedValue([baseDiff])
    setPendingSelfReviewComments(baseTask.id, [{ path: baseDiff.filename, line: 2, side: 'RIGHT', body: 'Keep this feedback' }])
    renderSelfReviewView()
    await screen.findByRole('region', { name: 'Diff scroll area' })
    if (mode === 'commit') {
      await fireEvent.click(await screen.findByTitle(commit.message))
      await screen.findByText('Show all changes')
    } else {
      await fireEvent.click(screen.getByLabelText('Include uncommitted changes'))
    }
    const scrollArea = await screen.findByRole('region', { name: 'Diff scroll area' })
    await fireEvent.click(await screen.findByLabelText('Mark src/main.rs reviewed'))
    await screen.findByLabelText('Reviewed file src/main.rs')
    const filter = screen.getByRole('searchbox', { name: 'Filter changed files' }) as HTMLInputElement
    await fireEvent.input(filter, { target: { value: 'main.rs' } })
    const tree = screen.getByRole('tree', { name: 'Changed files' })
    tree.scrollTop = 90
    scrollArea.scrollTop = 184
    await fireEvent.scroll(scrollArea)
    await fireEvent.click(screen.getByRole('tab', { name: 'GitHub comments' }))
    expect(screen.getByRole('button', { name: 'Send feedback (1)' })).toBeTruthy()
    await fireEvent.click(screen.getByRole('tab', { name: 'Changed files' }))
    expect((screen.getByRole('searchbox', { name: 'Filter changed files' }) as HTMLInputElement).value).toBe('main.rs')
    expect(screen.getByRole('tree', { name: 'Changed files' }).scrollTop).toBe(90)
    expect(screen.getByRole('region', { name: 'Diff scroll area' }).scrollTop).toBe(184)
    expect(screen.getByLabelText('Reviewed file src/main.rs')).toBeTruthy()
    if (mode === 'commit') expect(screen.getByText('Show all changes')).toBeTruthy()
    else expect((screen.getByLabelText('Include uncommitted changes') as HTMLInputElement).checked).toBe(false)
  })
})
