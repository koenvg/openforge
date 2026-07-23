import {
  applyCreate,
  buildBoard,
  type BoardCard,
  type BoardModel,
  type RoadmapIssueTaskLink,
} from './board'
import type { RoadmapBoard } from './types'

export interface PendingCardReconciliation {
  board: BoardModel
  pendingCards: BoardCard[]
}

export function modelFromRoadmapBoard(
  raw: RoadmapBoard,
  taskLinks: Record<number, RoadmapIssueTaskLink> = {},
): BoardModel {
  const values: Record<number, number> = {}
  for (const [key, value] of Object.entries(raw.values)) {
    values[Number(key)] = value
  }

  const labelColors: Record<string, string> = {}
  for (const label of raw.labels) {
    labelColors[label.name] = label.color
  }

  return buildBoard({
    repo: `${raw.repo.owner}/${raw.repo.name}`,
    issues: raw.issues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      labels: issue.labels.map((label) => label.name),
    })),
    columnLabels: raw.columnLabels,
    labelColors,
    values,
    taskLinks,
  })
}

export function reconcilePendingCreatedCards(
  model: BoardModel,
  raw: RoadmapBoard,
  pendingCards: BoardCard[],
): PendingCardReconciliation {
  const loadedIssueNumbers = new Set(raw.issues.map((issue) => issue.number))
  const remainingPendingCards = pendingCards.filter(
    (card) => !loadedIssueNumbers.has(card.issueNumber),
  )

  return {
    board: remainingPendingCards.reduce(
      (current, card) => applyCreate(current, card),
      model,
    ),
    pendingCards: remainingPendingCards,
  }
}

export function patchBoardCardValue(
  board: BoardModel,
  issueNumber: number,
  value: number | null,
): BoardModel {
  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cards: column.cards.map((card) =>
        card.issueNumber === issueNumber ? { ...card, value } : card,
      ),
    })),
  }
}

export function patchBoardLabelColor(
  board: BoardModel,
  name: string,
  color: string,
): BoardModel {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.label === name ? { ...column, color } : column,
    ),
  }
}
