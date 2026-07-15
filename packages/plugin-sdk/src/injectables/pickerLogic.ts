import type { Injectable } from '../domain'

/** Format a character count with grouped thousands, e.g. 2309 -> "2,309 char". */
export function formatCharCount(count: number): string {
  const grouped = String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${grouped} char`
}

/**
 * Move a selection through an ordered list of ids by one step. `dir` is +1 (down) or
 * -1 (up). With no current selection, down picks the first item and up the last. An
 * unknown current id (e.g. filtered out) falls back the same way. Wraps around the
 * ends (last → first on down, first → last on up).
 */
export function stepSelection(
  orderedIds: string[],
  currentId: string | null,
  dir: 1 | -1,
): string | null {
  if (orderedIds.length === 0) return null
  const idx = currentId === null ? -1 : orderedIds.indexOf(currentId)
  if (idx === -1) return dir === 1 ? orderedIds[0] : orderedIds[orderedIds.length - 1]
  const n = orderedIds.length
  return orderedIds[(idx + dir + n) % n]
}

/**
 * Whether a picker item is a personal skill the user can edit or delete in place. Only
 * personal-origin skills that carry a Claude source dir + folder identity can be located
 * on disk; everything else (project/plugin/built-in items, personal commands with no
 * source path) is read-only in the picker.
 */
export function isEditablePersonalSkill(
  injectable: Pick<Injectable, 'origin' | 'kind' | 'sourceDir' | 'sourcePath'>,
): boolean {
  return (
    injectable.origin === 'personal' &&
    injectable.kind === 'skill' &&
    !!injectable.sourceDir &&
    !!injectable.sourcePath
  )
}

/** Whether a picker item is a personal snippet the user can edit or delete in place. */
export function isEditableSnippet(injectable: Pick<Injectable, 'kind'>): boolean {
  return injectable.kind === 'snippet'
}

/** A snippet's project availability: all projects (incl. future) or an explicit subset. */
export interface ProjectScope {
  allProjects: boolean
  projectIds: string[]
}

/** Whether a project's checkbox shows as checked for the given scope. */
export function isProjectChecked(scope: ProjectScope, projectId: string): boolean {
  return scope.allProjects || scope.projectIds.includes(projectId)
}

/** Toggle the "All projects" checkbox. Turning it off clears the explicit list. */
export function toggleAllProjectsScope(scope: ProjectScope): ProjectScope {
  return scope.allProjects
    ? { allProjects: false, projectIds: [] }
    : { allProjects: true, projectIds: [] }
}

/**
 * Toggle one project's checkbox. Starting from "All projects" expands to the explicit
 * set first. If the result covers every project, it collapses back to the `allProjects`
 * flag (so future projects are included). `projectIds` stays in `allProjectIds` order.
 */
export function toggleProjectInScope(
  scope: ProjectScope,
  projectId: string,
  allProjectIds: string[],
): ProjectScope {
  const checked = new Set(scope.allProjects ? allProjectIds : scope.projectIds)
  if (checked.has(projectId)) checked.delete(projectId)
  else checked.add(projectId)
  const coversAll = allProjectIds.length > 0 && allProjectIds.every((id) => checked.has(id))
  if (coversAll) return { allProjects: true, projectIds: [] }
  return { allProjects: false, projectIds: allProjectIds.filter((id) => checked.has(id)) }
}

/**
 * The snippet's DB id, parsed from the `snippet:${dbId}` injectable id. Returns
 * null for non-snippet items. Used to target update/delete IPC calls.
 */
export function snippetDbId(injectable: Pick<Injectable, 'kind' | 'id'>): string | null {
  if (injectable.kind !== 'snippet') return null
  const prefix = 'snippet:'
  return injectable.id.startsWith(prefix) ? injectable.id.slice(prefix.length) : null
}

/**
 * A keyboard-navigable row in the picker's two-level tree: a group header, or an item
 * under a group. `id` is the group header id (`group:${key}`) or the item's id.
 */
export interface NavRow {
  id: string
  kind: 'header' | 'item'
  groupKey: string
}

/** The id used for a group header row. */
export function groupRowId(groupKey: string): string {
  return `group:${groupKey}`
}

/**
 * Flatten grouped injectables into keyboard rows: each group's header, followed by its
 * item rows when the group is expanded. Mirrors a file tree's visible-node list.
 */
export function flattenNavRows(
  groups: { key: string; items: { id: string }[] }[],
  collapsedKeys: Set<string>,
): NavRow[] {
  const rows: NavRow[] = []
  for (const g of groups) {
    rows.push({ id: groupRowId(g.key), kind: 'header', groupKey: g.key })
    if (!collapsedKeys.has(g.key)) {
      for (const it of g.items) rows.push({ id: it.id, kind: 'item', groupKey: g.key })
    }
  }
  return rows
}

export type TreeKeyResult =
  | { type: 'none' }
  | { type: 'toggle'; groupKey: string; focusId: string }
  | { type: 'focus'; focusId: string }

/**
 * ArrowRight: on a collapsed header, expand it (focus stays); on an expanded header,
 * dive to its first item; on an item (leaf), nothing.
 */
export function navRight(
  rows: NavRow[],
  focusedId: string | null,
  collapsedKeys: Set<string>,
): TreeKeyResult {
  const row = rows.find((r) => r.id === focusedId)
  if (!row || row.kind === 'item') return { type: 'none' }
  if (collapsedKeys.has(row.groupKey)) {
    return { type: 'toggle', groupKey: row.groupKey, focusId: row.id }
  }
  const firstItem = rows.find((r) => r.kind === 'item' && r.groupKey === row.groupKey)
  return firstItem ? { type: 'focus', focusId: firstItem.id } : { type: 'none' }
}

/**
 * ArrowLeft: on an item, collapse its group and move to the header; on an expanded
 * header, collapse it (focus stays); on an already-collapsed header, nothing.
 */
export function navLeft(
  rows: NavRow[],
  focusedId: string | null,
  collapsedKeys: Set<string>,
): TreeKeyResult {
  const row = rows.find((r) => r.id === focusedId)
  if (!row) return { type: 'none' }
  if (row.kind === 'item') {
    return { type: 'toggle', groupKey: row.groupKey, focusId: groupRowId(row.groupKey) }
  }
  if (!collapsedKeys.has(row.groupKey)) {
    return { type: 'toggle', groupKey: row.groupKey, focusId: row.id }
  }
  return { type: 'none' }
}

/**
 * Find an injectable by its on-disk identity (source dir + folder name), which is stable
 * across a frontmatter `name` change. Used to keep the selection on the same skill after
 * an edit renames it (the id, `origin:kind:name`, changes but the folder does not).
 */
export function findInjectableBySource(
  items: Injectable[],
  sourceDir: string | null,
  sourcePath: string | null,
): Injectable | null {
  if (!sourceDir || !sourcePath) return null
  return items.find((i) => i.sourceDir === sourceDir && i.sourcePath === sourcePath) ?? null
}
