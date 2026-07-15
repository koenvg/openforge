import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import CardDrawer from './CardDrawer.svelte'
import type { BoardCard } from '../lib/board'
import type { RepoLabel } from '../lib/types'

const card: BoardCard = {
  issueNumber: 42,
  title: 'Improve roadmap sync',
  body: 'Keep GitHub issues and local values aligned.',
  labels: ['bug'],
  value: 5,
  taskLink: null,
}

const labels: RepoLabel[] = [
  { name: 'bug', color: 'd73a4a' },
  { name: 'enhancement', color: 'a2eeef' },
]

function renderDrawer(overrides: Record<string, unknown> = {}) {
  return render(CardDrawer, {
    props: {
      card,
      repo: 'owner/repo',
      allLabels: labels,
      busy: false,
      index: 2,
      total: 7,
      groupTitle: 'bug',
      onPrev: vi.fn(),
      onNext: vi.fn(),
      onClose: vi.fn(),
      onOpenUrl: vi.fn(),
      onCopyLink: vi.fn(),
      onSaveText: vi.fn(() => Promise.resolve(true)),
      onSetValue: vi.fn(),
      onToggleLabel: vi.fn(),
      onCloseIssue: vi.fn(),
      onOpenTask: vi.fn(),
      ...overrides,
    },
  })
}

/** Make the title differ from the card so `dirty` is true. */
async function makeDirty() {
  const input = screen.getByLabelText('Title') as HTMLInputElement
  await fireEvent.input(input, { target: { value: 'A different title' } })
}

describe('CardDrawer', () => {
  it('uses shared modal close behavior for Escape and backdrop clicks', async () => {
    const onClose = vi.fn()
    renderDrawer({ onClose })

    const dialog = screen.getByRole('dialog', { name: 'Issue #42' })
    await fireEvent.keyDown(dialog, { key: 'Escape' })
    await fireEvent.click(dialog)

    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('links to the OpenForge task started from the ticket', async () => {
    const onOpenTask = vi.fn()
    renderDrawer({
      card: {
        ...card,
        taskLink: {
          taskId: 'KVG-42',
          sessionId: 'session-42',
          workspacePath: '/tmp/kvg-42',
          repo: 'owner/repo',
          title: 'Improve roadmap sync',
        },
      },
      onOpenTask,
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Open task details KVG-42' }))

    expect(onOpenTask).toHaveBeenCalledWith('KVG-42')
  })

  it('shows the pager position for the opened group', () => {
    renderDrawer()
    expect(screen.getByText('3 of 7 · bug')).toBeTruthy()
  })

  it('walks the group with the pager arrows', async () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    renderDrawer({ onPrev, onNext })

    await fireEvent.click(screen.getByRole('button', { name: 'Next issue in bug' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Previous issue in bug' }))

    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onPrev).toHaveBeenCalledTimes(1)
  })

  it('walks the group with the arrow keys', async () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    renderDrawer({ onPrev, onNext })

    const dialog = screen.getByRole('dialog', { name: 'Issue #42' })
    await fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    await fireEvent.keyDown(dialog, { key: 'ArrowLeft' })

    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onPrev).toHaveBeenCalledTimes(1)
  })

  it('leaves the arrow keys inert while typing in a text field', async () => {
    const onNext = vi.fn()
    renderDrawer({ onNext })

    const input = screen.getByLabelText('Title') as HTMLInputElement
    input.focus()
    await fireEvent.keyDown(input, { key: 'ArrowRight' })

    expect(onNext).not.toHaveBeenCalled()
  })

  it('leaves the arrow keys inert when a modifier is held', async () => {
    const onNext = vi.fn()
    renderDrawer({ onNext })

    const dialog = screen.getByRole('dialog', { name: 'Issue #42' })
    await fireEvent.keyDown(dialog, { key: 'ArrowRight', altKey: true })

    expect(onNext).not.toHaveBeenCalled()
  })

  it('blurs a focused field on the first Escape and closes on the second', async () => {
    const onClose = vi.fn()
    renderDrawer({ onClose })

    const input = screen.getByLabelText('Title') as HTMLInputElement
    input.focus()
    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(input)

    const dialog = screen.getByRole('dialog', { name: 'Issue #42' })
    await fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('guards an exit with unsaved edits instead of leaving immediately', async () => {
    const onNext = vi.fn()
    renderDrawer({ onNext })
    await makeDirty()

    await fireEvent.click(screen.getByRole('button', { name: 'Next issue in bug' }))

    expect(onNext).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('discards edits and runs the exit when Discard is chosen', async () => {
    const onNext = vi.fn()
    renderDrawer({ onNext })
    await makeDirty()
    await fireEvent.click(screen.getByRole('button', { name: 'Next issue in bug' }))

    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(onNext).toHaveBeenCalledTimes(1)
    const input = screen.getByLabelText('Title') as HTMLInputElement
    expect(input.value).toBe('Improve roadmap sync')
  })

  it('saves then navigates when Save & continue is chosen', async () => {
    const onSaveText = vi.fn(() => Promise.resolve(true))
    const onNext = vi.fn()
    renderDrawer({ onSaveText, onNext })
    await makeDirty()
    await fireEvent.click(screen.getByRole('button', { name: 'Next issue in bug' }))

    await fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }))

    await waitFor(() => expect(onSaveText).toHaveBeenCalledWith('A different title', card.body))
    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1))
  })

  it('keeps the drawer put with edits intact when the save fails', async () => {
    const onSaveText = vi.fn(() => Promise.resolve(false))
    const onNext = vi.fn()
    renderDrawer({ onSaveText, onNext })
    await makeDirty()
    await fireEvent.click(screen.getByRole('button', { name: 'Next issue in bug' }))

    await fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }))

    await waitFor(() => expect(onSaveText).toHaveBeenCalledTimes(1))
    expect(onNext).not.toHaveBeenCalled()
    const input = screen.getByLabelText('Title') as HTMLInputElement
    expect(input.value).toBe('A different title')
  })

  it('cancels the exit and keeps edits when Cancel is chosen', async () => {
    const onClose = vi.fn()
    renderDrawer({ onClose })
    await makeDirty()

    const dialog = screen.getByRole('dialog', { name: 'Issue #42' })
    await fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.getByRole('alertdialog')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const input = screen.getByLabelText('Title') as HTMLInputElement
    expect(input.value).toBe('A different title')
  })
})
