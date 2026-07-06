import { fireEvent, render, screen } from '@testing-library/svelte'
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
      onClose: vi.fn(),
      onOpenUrl: vi.fn(),
      onCopyLink: vi.fn(),
      onSaveText: vi.fn(),
      onSetValue: vi.fn(),
      onToggleLabel: vi.fn(),
      onCloseIssue: vi.fn(),
      ...overrides,
    },
  })
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
})
