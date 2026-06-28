// Pure board-assembly logic, ported from the standalone github-roadmap app
// (src/lib/board/{columns,sort,build,optimistic}.ts). Adapted for the OpenForge
// MVP: no PRs, no manual ordering, no comments. Cards sort by value descending,
// then issue number descending. All functions are pure.

export interface BoardIssue {
  number: number
  title: string
  body: string | null
  labels: string[]
}

export interface BoardCard {
  issueNumber: number
  title: string
  body: string | null
  labels: string[]
  value: number | null
}

export interface BoardColumn {
  /** '' for the No label / Other column. */
  label: string
  isOther: boolean
  title: string
  /** The label's GitHub hex (no '#'); null for Other or unknown labels. */
  color: string | null
  cards: BoardCard[]
}

export interface BoardModel {
  repo: string
  /** Curated columns in order, then the Other column last. */
  columns: BoardColumn[]
}

export interface BuildBoardInput {
  repo: string
  issues: BoardIssue[]
  columnLabels: string[]
  /** label name → GitHub hex (no '#'); absent → no tint. */
  labelColors?: Record<string, string>
  /** issue number → value (1..10). */
  values: Record<number, number>
}

export const OTHER_TITLE = 'No label / Other'

/** Sort by value descending, then by issue number descending. Returns a new array. */
export function sortColumnCards(cards: BoardCard[]): BoardCard[] {
  return [...cards].sort((a, b) => {
    const av = a.value ?? -Infinity
    const bv = b.value ?? -Infinity
    if (bv !== av) return bv - av // higher value first
    return b.issueNumber - a.issueNumber // newer first
  })
}

/**
 * Build the curated label columns (in order) plus a trailing "No label / Other"
 * column. A card appears in every curated column whose label it carries; cards
 * with no curated label fall into Other.
 */
export function placeCards(
  cards: BoardCard[],
  columnLabels: string[],
  labelColors: Record<string, string> = {},
): BoardColumn[] {
  const columns: BoardColumn[] = columnLabels.map((label) => ({
    label,
    isOther: false,
    title: label,
    color: labelColors[label] ?? null,
    cards: cards.filter((c) => c.labels.includes(label)),
  }))
  const other = cards.filter((c) => !c.labels.some((l) => columnLabels.includes(l)))
  columns.push({ label: '', isOther: true, title: OTHER_TITLE, color: null, cards: other })
  return columns
}

/** Fold open issues + local values into a sorted board model. */
export function buildBoard(input: BuildBoardInput): BoardModel {
  const cards: BoardCard[] = input.issues.map((i) => ({
    issueNumber: i.number,
    title: i.title,
    body: i.body,
    labels: i.labels,
    value: input.values[i.number] ?? null,
  }))

  const columns = placeCards(cards, input.columnLabels, input.labelColors).map((col) => ({
    ...col,
    cards: sortColumnCards(col.cards),
  }))

  return { repo: input.repo, columns }
}

/**
 * Insert a freshly created card into the board so it shows immediately, without
 * waiting on GitHub's eventually-consistent issue list. Placed at the top of
 * every curated column whose label it carries (or Other if it carries none).
 * Idempotent. Pure.
 */
export function applyCreate(board: BoardModel, card: BoardCard): BoardModel {
  const curated = board.columns.filter((c) => !c.isOther).map((c) => c.label)
  return {
    ...board,
    columns: board.columns.map((col) => {
      const belongs = col.isOther
        ? !card.labels.some((l) => curated.includes(l))
        : card.labels.includes(col.label)
      if (!belongs || col.cards.some((c) => c.issueNumber === card.issueNumber)) return col
      return { ...col, cards: [card, ...col.cards] }
    }),
  }
}

/** Update an issue's title across every column it appears in. Pure. */
export function applyRename(board: BoardModel, issueNumber: number, title: string): BoardModel {
  return {
    ...board,
    columns: board.columns.map((col) => ({
      ...col,
      cards: col.cards.map((c) => (c.issueNumber === issueNumber ? { ...c, title } : c)),
    })),
  }
}

/**
 * Optimistically move an issue between columns by removing `fromLabel` and adding
 * `toLabel` (either may be '' to mean "no curated label" / the Other column),
 * then re-placing the card into every column it now belongs to. Mirrors the
 * board's placement rules. The next refetch re-sorts. Pure.
 */
export function applyRelabel(
  board: BoardModel,
  issueNumber: number,
  fromLabel: string,
  toLabel: string,
): BoardModel {
  let card: BoardCard | null = null
  for (const col of board.columns) {
    const found = col.cards.find((c) => c.issueNumber === issueNumber)
    if (found) {
      card = found
      break
    }
  }
  if (!card) return board

  const curated = board.columns.filter((c) => !c.isOther).map((c) => c.label)
  let labels = fromLabel ? card.labels.filter((l) => l !== fromLabel) : [...card.labels]
  if (toLabel && !labels.includes(toLabel)) labels = [...labels, toLabel]
  const moved: BoardCard = { ...card, labels }

  return {
    ...board,
    columns: board.columns.map((col) => {
      const without = col.cards.filter((c) => c.issueNumber !== issueNumber)
      const belongs = col.isOther
        ? !labels.some((l) => curated.includes(l))
        : labels.includes(col.label)
      if (!belongs) return { ...col, cards: without }
      if (without.some((c) => c.issueNumber === issueNumber)) return { ...col, cards: without }
      return { ...col, cards: [...without, moved] }
    }),
  }
}
