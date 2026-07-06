import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import ColumnSettingsModal from './ColumnSettingsModal.svelte'
import type { LabelUsage } from '../lib/types'

const labels: LabelUsage[] = [
  { name: 'alpha', color: 'd73a4a', used: true },
  { name: 'beta', color: 'a2eeef', used: true },
  { name: 'gamma', color: '00ff00', used: true },
]

function renderModal(overrides: Record<string, unknown> = {}) {
  return render(ColumnSettingsModal, {
    props: {
      repo: 'owner/repo',
      labels,
      initialColumnLabels: ['alpha', 'beta', 'gamma'],
      busy: false,
      error: null,
      onClose: vi.fn(),
      onSave: vi.fn(),
      onRecolor: vi.fn(async () => {}),
      ...overrides,
    },
  })
}

describe('ColumnSettingsModal', () => {
  it('Save reports the current order', async () => {
    const onSave = vi.fn()
    renderModal({ onSave })
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(['alpha', 'beta', 'gamma'])
  })

  it('Save reports the reordered labels', async () => {
    const onSave = vi.fn()
    renderModal({ onSave })
    // Move alpha down: alpha,beta,gamma -> beta,alpha,gamma
    await fireEvent.click(screen.getByRole('button', { name: 'Move alpha down' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(['beta', 'alpha', 'gamma'])
  })

  it('hands a structured-cloneable array to onSave (no reactive proxy)', async () => {
    // The saved labels cross the Electron IPC boundary, which structured-clones
    // the payload. A raw Svelte $state proxy throws "could not be cloned".
    let received: unknown = null
    renderModal({
      onSave: (saved: string[]) => {
        received = saved
      },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Move alpha down' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(() => structuredClone(received)).not.toThrow()
  })

  it('shows an error message when one is provided', () => {
    renderModal({ error: 'could not save columns' })
    expect(screen.getByText('could not save columns')).toBeTruthy()
  })

  it('shows no error region when error is null', () => {
    renderModal({ error: null })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('uses shared modal close behavior for Escape and backdrop clicks', async () => {
    const onClose = vi.fn()
    renderModal({ onClose })

    const dialog = screen.getByRole('dialog', { name: 'Columns for owner/repo' })
    await fireEvent.keyDown(dialog, { key: 'Escape' })
    await fireEvent.click(dialog)

    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
