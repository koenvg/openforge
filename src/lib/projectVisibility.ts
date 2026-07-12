import type { Project } from './types'
import { getConfig, setConfig } from './ipc'

/** Global config key holding the JSON array of hidden project ids. */
export const HIDDEN_PROJECTS_CONFIG_KEY = 'project_sidebar_hidden'

/** Parse the stored config value into a set of hidden project ids; tolerant of null/garbage. */
export function parseHiddenProjectIds(raw: string | null): Set<string> {
  if (!raw) return new Set()
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    return new Set()
  }
}

/** Serialize the hidden project ids for persistence. */
export function serializeHiddenProjectIds(ids: ReadonlySet<string>): string {
  return JSON.stringify(Array.from(ids))
}

/** Split projects into visible and hidden lists, preserving order within each. */
export function partitionProjectsByHidden(
  projects: Project[],
  hidden: ReadonlySet<string>,
): { visible: Project[]; hidden: Project[] } {
  const visible: Project[] = []
  const hiddenList: Project[] = []
  for (const project of projects) {
    if (hidden.has(project.id)) hiddenList.push(project)
    else visible.push(project)
  }
  return { visible, hidden: hiddenList }
}

/** Return a new set with `id` added (shouldHide) or removed; never mutates the input. */
export function withProjectHidden(
  hidden: ReadonlySet<string>,
  id: string,
  shouldHide: boolean,
): Set<string> {
  const next = new Set(hidden)
  if (shouldHide) next.add(id)
  else next.delete(id)
  return next
}

/**
 * Reorder the visible project at `visibleIndex` up/down among the visible projects,
 * swapping it with its adjacent visible neighbour. Hidden projects keep their absolute
 * slots in the returned full-order array. Out-of-bounds moves return an unchanged copy.
 */
export function moveVisibleProject(
  projects: Project[],
  hidden: ReadonlySet<string>,
  visibleIndex: number,
  direction: 'up' | 'down',
): Project[] {
  const next = [...projects]
  const visible = next.filter((p) => !hidden.has(p.id))
  const targetVisibleIndex = direction === 'up' ? visibleIndex - 1 : visibleIndex + 1

  if (
    visibleIndex < 0 ||
    visibleIndex >= visible.length ||
    targetVisibleIndex < 0 ||
    targetVisibleIndex >= visible.length
  ) {
    return next
  }

  const aIndex = next.findIndex((p) => p.id === visible[visibleIndex].id)
  const bIndex = next.findIndex((p) => p.id === visible[targetVisibleIndex].id)
  ;[next[aIndex], next[bIndex]] = [next[bIndex], next[aIndex]]
  return next
}

/** Load the persisted hidden project ids from global config. */
export async function loadHiddenProjectIds(): Promise<Set<string>> {
  return parseHiddenProjectIds(await getConfig(HIDDEN_PROJECTS_CONFIG_KEY))
}

/** Persist the hidden project ids to global config. */
export async function saveHiddenProjectIds(ids: ReadonlySet<string>): Promise<void> {
  await setConfig(HIDDEN_PROJECTS_CONFIG_KEY, serializeHiddenProjectIds(ids))
}
