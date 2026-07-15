import type {
  Injectable,
  InjectableGroupBy,
  InjectableOrigin,
  InjectableSection,
  InjectableTriggerMode,
} from '../domain'

export const SNIPPET_SECTION_KEY = 'snippet' as const
export const SNIPPET_SECTION_LABEL = 'Snippets'

/**
 * The top-level section an item belongs to. Snippets are their own section
 * (they have no meaningful origin/trigger); everything else uses its origin.
 */
export function sectionOf(item: Injectable): InjectableSection {
  return item.kind === 'snippet' ? SNIPPET_SECTION_KEY : item.origin
}

// Filter chip order for the ⌘1/⌘2 cycle: conceptually [All, ...SECTION_ORDER],
// where "All" (position 0) is the empty selection. Matches the chip row order.
export const SECTION_ORDER: InjectableSection[] = ['snippet', 'personal', 'project', 'plugin', 'builtin']

/**
 * Advance the single-select filter cursor by `dir` (+1 right, -1 left), circularly,
 * over [All, ...SECTION_ORDER]. A multi-selection has no single cursor, so it is
 * treated as All (index 0). Returns the new selection (empty array = All),
 * overwriting any prior multi-selection.
 */
export function cycleSectionFilter(current: InjectableSection[], dir: 1 | -1): InjectableSection[] {
  const positions = SECTION_ORDER.length + 1 // +1 for the leading "All"
  const cursor = current.length === 1 ? SECTION_ORDER.indexOf(current[0]) + 1 : 0
  const next = (cursor + dir + positions) % positions
  return next === 0 ? [] : [SECTION_ORDER[next - 1]]
}

export const ORIGIN_LABELS: Record<InjectableOrigin, string> = {
  personal: 'Personal',
  project: 'Project',
  plugin: 'Plugin',
  builtin: 'Claude Code',
}

export const ORIGIN_DESCRIPTIONS: Record<InjectableOrigin, string> = {
  personal: 'Your own, in ~/.claude — across all your projects',
  project: 'Committed to this repo — shared with your team',
  plugin: 'From an installed plugin',
  builtin: 'Ships with Claude Code itself — not a file you own',
}

export const TRIGGER_LABELS: Record<InjectableTriggerMode, string> = {
  'auto+manual': 'auto + manual',
  'manual-only': 'manual only',
}

const ORIGIN_ORDER: InjectableOrigin[] = ['personal', 'project', 'plugin', 'builtin']
const TRIGGER_ORDER: InjectableTriggerMode[] = ['auto+manual', 'manual-only']

export function searchInjectables(items: Injectable[], query: string): Injectable[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter(
    (i) => i.name.toLowerCase().includes(q) || (i.description?.toLowerCase().includes(q) ?? false),
  )
}

export function filterInjectables(
  items: Injectable[],
  filters: {
    sections?: InjectableSection[]
    origins?: InjectableOrigin[]
    triggers?: InjectableTriggerMode[]
  },
): Injectable[] {
  const sections = filters.sections ?? []
  const origins = filters.origins ?? []
  const triggers = filters.triggers ?? []
  return items.filter((i) => {
    if (sections.length && !sections.includes(sectionOf(i))) return false
    if (origins.length && !origins.includes(i.origin)) return false
    if (triggers.length && !triggers.includes(i.triggerMode)) return false
    return true
  })
}

export interface InjectableGroup {
  key: string
  label: string
  items: Injectable[]
}

export function groupInjectables(items: Injectable[], by: InjectableGroupBy): InjectableGroup[] {
  const map = new Map<string, Injectable[]>()
  for (const item of items) {
    // Snippets always form their own section, independent of the group-by axis.
    const key =
      item.kind === 'snippet' ? SNIPPET_SECTION_KEY : by === 'trigger' ? item.triggerMode : item.origin
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  // Snippets lead in both modes, then the axis's canonical order.
  const order: string[] = [SNIPPET_SECTION_KEY, ...(by === 'trigger' ? TRIGGER_ORDER : ORIGIN_ORDER)]
  const label = (key: string): string =>
    key === SNIPPET_SECTION_KEY
      ? SNIPPET_SECTION_LABEL
      : by === 'trigger'
        ? TRIGGER_LABELS[key as InjectableTriggerMode]
        : ORIGIN_LABELS[key as InjectableOrigin]
  return order
    .filter((key) => map.has(key))
    .map((key) => ({ key, label: label(key), items: map.get(key)! }))
}
