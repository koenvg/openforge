import type { TaskAttentionRow } from './types'

/** Count the backend-authoritative Task attention rows per Project for desktop badges. */
export function buildAttentionCountByProject(rows: TaskAttentionRow[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1)
  }
  return counts
}
