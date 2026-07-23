import { describe, expect, it } from 'vitest'
import type { BoardModel } from '../lib/board'
import { useRoadmapDrawer } from './useRoadmapDrawer.svelte'

function makeBoard(issueNumbers: number[]): BoardModel {
  return {
    repo: 'octo/cat',
    columns: [
      {
        label: 'alpha',
        isOther: false,
        title: 'alpha',
        color: 'ff0000',
        cards: issueNumbers.map((issueNumber) => ({
          issueNumber,
          title: `Issue ${issueNumber}`,
          body: '',
          labels: ['alpha'],
          value: null,
          taskLink: null,
        })),
      },
    ],
  }
}

describe('useRoadmapDrawer', () => {
  it('freezes the clicked column order while resolving the selected card from the live board', () => {
    let board = makeBoard([3, 2, 1])
    const drawer = useRoadmapDrawer(() => board)
    const column = board.columns[0]!

    drawer.openFrom(column.cards[1]!, column)
    expect(drawer.open).toMatchObject({ groupTitle: 'alpha', issueNumbers: [3, 2, 1], index: 1 })
    expect(drawer.selectedCard?.title).toBe('Issue 2')

    board = {
      ...board,
      columns: board.columns.map((current) => ({
        ...current,
        cards: current.cards.map((card) =>
          card.issueNumber === 2 ? { ...card, title: 'Renamed live' } : card,
        ),
      })),
    }

    expect(drawer.selectedCard?.title).toBe('Renamed live')
    expect(drawer.open?.issueNumbers).toEqual([3, 2, 1])
  })

  it('skips issues that left the live board and closes when none remain', () => {
    let board = makeBoard([3, 2, 1])
    const drawer = useRoadmapDrawer(() => board)
    const column = board.columns[0]!

    drawer.openFrom(column.cards[0]!, column)
    board = makeBoard([3, 1])
    drawer.go(1)
    expect(drawer.openIssueNumber).toBe(1)

    board = makeBoard([])
    drawer.go(1)
    expect(drawer.open).toBeNull()
  })

  it('advances past a closed issue before the board refresh removes it', () => {
    const board = makeBoard([3, 2, 1])
    const drawer = useRoadmapDrawer(() => board)
    const column = board.columns[0]!

    drawer.openFrom(column.cards[1]!, column)
    drawer.advancePastClosed(2)

    expect(drawer.openIssueNumber).toBe(1)
  })
})
