import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import CreateDialog from './CreateDialog.svelte'
import type { RepoLabel } from '../lib/types'

const labels: RepoLabel[] = [
  { name: 'bug', color: 'd73a4a' },
  { name: 'enhancement', color: 'a2eeef' },
]

describe('CreateDialog', () => {
  function renderDialog(overrides: Record<string, unknown> = {}) {
    return render(CreateDialog, {
      props: {
        labelOptions: labels,
        initialLabels: [],
        busy: false,
        hasApiKey: true,
        onClose: vi.fn(),
        onCreate: vi.fn(),
        onOpenUrl: vi.fn(),
        onRefine: vi.fn(),
        ...overrides,
      },
    })
  }

  const NO_KEY_HINT = 'Add API key in project settings → Roadmap.'

  it('includes initial labels when manually creating an issue', async () => {
    const onCreate = vi.fn()
    renderDialog({ initialLabels: ['bug'], onCreate })

    await fireEvent.input(screen.getByLabelText('Describe the issue'), { target: { value: 'Fix login redirect' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Skip AI' }))
    await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Fix login redirect' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))

    expect(onCreate).toHaveBeenCalledWith('Fix login redirect', '', ['bug'])
  })

  it('refines a rough note into an editable draft before creating', async () => {
    const onCreate = vi.fn()
    const onRefine = vi.fn(async () => ({ title: 'Autosave drafts', body: 'Persist the draft on reload.' }))
    renderDialog({ onCreate, onRefine })

    await fireEvent.input(screen.getByLabelText('Describe the issue'), {
      target: { value: 'users lose their draft when the tab reloads' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Refine' }))

    await waitFor(() => expect(screen.getByDisplayValue('Autosave drafts')).toBeTruthy())
    expect(onRefine).toHaveBeenCalledWith({
      text: 'users lose their draft when the tab reloads',
      draft: null,
      feedback: '',
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))
    expect(onCreate).toHaveBeenCalledWith('Autosave drafts', 'Persist the draft on reload.', [])
  })

  it('revises the current draft using feedback instead of rerolling from scratch', async () => {
    const onRefine = vi
      .fn()
      .mockResolvedValueOnce({ title: 'Draft v1', body: 'First body.' })
      .mockResolvedValueOnce({ title: 'Draft v2', body: 'Tighter body.' })
    renderDialog({ onRefine })

    await fireEvent.input(screen.getByLabelText('Describe the issue'), { target: { value: 'do the thing' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Refine' }))
    await waitFor(() => expect(screen.getByDisplayValue('Draft v1')).toBeTruthy())

    await fireEvent.input(screen.getByLabelText('Feedback'), { target: { value: 'make it tighter' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Refine with feedback' }))

    await waitFor(() => expect(screen.getByDisplayValue('Draft v2')).toBeTruthy())
    expect(onRefine).toHaveBeenLastCalledWith({
      text: 'do the thing',
      draft: { title: 'Draft v1', body: 'First body.' },
      feedback: 'make it tighter',
    })
  })

  describe('without an API key', () => {
    it('disables Refine and says where to add the key', async () => {
      renderDialog({ hasApiKey: false })
      await fireEvent.input(screen.getByLabelText('Describe the issue'), { target: { value: 'do the thing' } })

      const refine = screen.getByRole('button', { name: 'Refine' })
      expect((refine as HTMLButtonElement).disabled).toBe(true)
      expect(refine.getAttribute('title')).toBe(NO_KEY_HINT)
    })

    it('never calls onRefine, so no request is attempted without a key', async () => {
      const onRefine = vi.fn()
      renderDialog({ hasApiKey: false, onRefine })

      await fireEvent.input(screen.getByLabelText('Describe the issue'), { target: { value: 'do the thing' } })
      await fireEvent.click(screen.getByRole('button', { name: 'Refine' }))

      expect(onRefine).not.toHaveBeenCalled()
    })

    it('leaves Skip AI usable, so a ticket can still be written by hand', async () => {
      const onCreate = vi.fn()
      renderDialog({ hasApiKey: false, onCreate })

      await fireEvent.input(screen.getByLabelText('Describe the issue'), { target: { value: 'Fix login redirect' } })
      const skip = screen.getByRole('button', { name: 'Skip AI' })
      expect((skip as HTMLButtonElement).disabled).toBe(false)

      await fireEvent.click(skip)
      await fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))
      expect(onCreate).toHaveBeenCalledWith('Fix login redirect', '', [])
    })

    it('gates the feedback revision too, since it takes the same path', async () => {
      const onRefine = vi.fn(async () => ({ title: 'Draft v1', body: 'First body.' }))
      renderDialog({ hasApiKey: false, onRefine })

      await fireEvent.input(screen.getByLabelText('Describe the issue'), { target: { value: 'do the thing' } })
      await fireEvent.click(screen.getByRole('button', { name: 'Skip AI' }))
      await fireEvent.input(screen.getByLabelText('Feedback'), { target: { value: 'make it tighter' } })

      const revise = screen.getByRole('button', { name: 'Refine with feedback' })
      expect((revise as HTMLButtonElement).disabled).toBe(true)
      expect(revise.getAttribute('title')).toBe(NO_KEY_HINT)

      await fireEvent.click(revise)
      expect(onRefine).not.toHaveBeenCalled()
    })
  })

  it('carries no key hint on Refine once a key is configured', async () => {
    renderDialog({ hasApiKey: true })
    await fireEvent.input(screen.getByLabelText('Describe the issue'), { target: { value: 'do the thing' } })

    const refine = screen.getByRole('button', { name: 'Refine' })
    expect((refine as HTMLButtonElement).disabled).toBe(false)
    expect(refine.getAttribute('title')).not.toBe(NO_KEY_HINT)
  })

  it('uses shared modal close behavior for Escape and backdrop clicks', async () => {
    const onClose = vi.fn()
    renderDialog({ onClose })

    const dialog = screen.getByRole('dialog')
    await fireEvent.keyDown(dialog, { key: 'Escape' })
    await fireEvent.click(dialog)

    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
