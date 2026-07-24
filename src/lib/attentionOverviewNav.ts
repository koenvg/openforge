/**
 * Focus-cursor movement for the "Needs your attention" overview.
 *
 * The overview lists tasks and review requests grouped under project headers.
 * Navigation rule: ↑/↓ move only between "navigable" rows — tasks, review
 * requests, and the header of a *collapsed* project. An *expanded* project's
 * header is a label that ↑/↓ skip (its items carry it), so the cursor never has
 * to stop on a project name just to pass through it. A collapsed project shows no
 * items, so its header stays reachable — that is the row ←/→ act on to re-expand
 * it. These pure helpers own that rule so it can be unit-tested in isolation.
 */

/** Minimal shape of a navigation row — only what focus movement needs. */
export interface NavRowLike {
  kind: 'header' | 'task' | 'review'
  group: { id: string }
}

/**
 * Tasks and reviews are always focusable. A project header is focusable ONLY when
 * its group is collapsed — then the header is the group's sole representative and
 * must be reachable so ←/→ can re-expand it. An expanded group's header is skipped.
 */
export function isNavigableRow(row: NavRowLike, collapsedIds: ReadonlySet<string>): boolean {
  if (row.kind !== 'header') return true
  return collapsedIds.has(row.group.id)
}

/** Index of the first navigable row, or -1 when there is none. */
export function firstNavigableIndex(rows: NavRowLike[], collapsedIds: ReadonlySet<string>): number {
  return rows.findIndex((row) => isNavigableRow(row, collapsedIds))
}

/**
 * Move the focus cursor by one navigable row in `delta` direction, skipping the
 * headers of expanded projects. Clamps at the ends (never wraps) and returns
 * `current` unchanged when there is no navigable row to move to.
 */
export function stepFocus(
  rows: NavRowLike[],
  current: number,
  delta: 1 | -1,
  collapsedIds: ReadonlySet<string>,
): number {
  for (let i = current + delta; i >= 0 && i < rows.length; i += delta) {
    if (isNavigableRow(rows[i], collapsedIds)) return i
  }
  return current
}

/**
 * Where the cursor lands when the dialog opens: the first navigable row of the
 * active project (so the user starts on what they're viewing), else the first
 * navigable row overall, else 0.
 */
export function initialFocusIndex(
  rows: NavRowLike[],
  activeGroupId: string | null,
  collapsedIds: ReadonlySet<string>,
): number {
  if (activeGroupId) {
    const idx = rows.findIndex((row) => isNavigableRow(row, collapsedIds) && row.group.id === activeGroupId)
    if (idx >= 0) return idx
  }
  const first = firstNavigableIndex(rows, collapsedIds)
  return first >= 0 ? first : 0
}

/**
 * Keep the cursor on a valid navigable row after the row list changes (e.g. a
 * project was collapsed): if it already points at a navigable row, keep it;
 * otherwise snap to the nearest navigable row at or before it, then after it.
 */
export function clampFocus(
  rows: NavRowLike[],
  current: number,
  collapsedIds: ReadonlySet<string>,
): number {
  if (rows.length === 0) return 0
  const clamped = Math.min(Math.max(current, 0), rows.length - 1)
  if (isNavigableRow(rows[clamped], collapsedIds)) return clamped
  for (let i = clamped - 1; i >= 0; i--) if (isNavigableRow(rows[i], collapsedIds)) return i
  for (let i = clamped + 1; i < rows.length; i++) if (isNavigableRow(rows[i], collapsedIds)) return i
  return clamped
}

/** Index of a group's header row, or -1 when the group has no header. */
export function headerIndexForGroup(rows: NavRowLike[], groupId: string): number {
  return rows.findIndex((row) => row.kind === 'header' && row.group.id === groupId)
}
