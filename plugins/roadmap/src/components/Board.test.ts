import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import Board from './Board.svelte'
import type { BoardColumn } from '../lib/board'

const columns: BoardColumn[] = [
  { label: 'bug', isOther: false, title: 'bug', color: null, cards: [] },
  { label: '', isOther: true, title: 'No label / Other', color: null, cards: [] },
]

function props(onAddCard = vi.fn()) {
  return {
    columns,
    repo: 'octo/cat',
    onCardClick: vi.fn(),
    onOpenUrl: vi.fn(),
    onCopyLink: vi.fn(),
    onRecolor: vi.fn(),
    onRunAction: vi.fn(),
    onAddCard,
  }
}

describe('Board column create actions', () => {
  it('opens create for a labeled column', async () => {
    const onAddCard = vi.fn()
    render(Board, { props: props(onAddCard) })

    await fireEvent.click(screen.getByRole('button', { name: 'Create issue in bug' }))

    expect(onAddCard).toHaveBeenCalledWith('bug')
  })

  it('opens create without labels from Other', async () => {
    const onAddCard = vi.fn()
    render(Board, { props: props(onAddCard) })

    await fireEvent.click(screen.getByRole('button', { name: 'Create issue with no label' }))

    expect(onAddCard).toHaveBeenCalledWith('')
  })
})
