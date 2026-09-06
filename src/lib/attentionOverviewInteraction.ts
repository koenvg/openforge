import { writable, type Readable } from 'svelte/store'
import { TASK_LANES, TASK_LANE_LABELS } from './attentionOverview'
import type { AttentionOverview, AttentionFocusTask, AttentionTaskReference } from './attentionOverview'
import type { BoardFilter } from './boardFilters'
import type { ReviewPullRequest } from './types'
import { clampFocus, headerIndexForGroup, initialFocusIndex, stepFocus } from './attentionOverviewNav'
import { resolveFocusedIndex } from './attentionOverviewRefresh'

const COLLAPSED_CONFIG_KEY = 'attention_overview_collapsed_projects'
const FILTERS_CONFIG_KEY = 'attention_overview_filters'
const OTHER_ID = '__other__'

/** Production reads IPC/stores; tests supply an in-memory adapter at this seam. */
export interface AttentionOverviewSource {
  load(): Promise<{ overview: AttentionOverview; activeId: string | null }>
  readConfig(key: string): Promise<string | null>
  writeConfig(key: string, value: string): Promise<unknown>
  subscribeChanges(onChange: () => void): () => void
}

export type AttentionOverviewIntent =
  | { kind: 'task'; task: AttentionTaskReference }
  | { kind: 'review'; pr: ReviewPullRequest; projectId: string | null }

interface DisplayGroup {
  id: string
  projectId: string | null
  name: string
  isActive: boolean
  taskItems: AttentionFocusTask[]
  reviewPrs: ReviewPullRequest[]
}

type NavRow =
  | { kind: 'header'; group: DisplayGroup }
  | { kind: 'task'; group: DisplayGroup; item: AttentionFocusTask }
  | { kind: 'review'; group: DisplayGroup; pr: ReviewPullRequest }

interface NavGroup {
  group: DisplayGroup
  headerIndex: number
  items: { row: NavRow; index: number }[]
}

export interface AttentionOverviewView {
  loading: boolean
  error: string | null
  preferenceError: string | null
  taskLane: BoardFilter
  laneLabel: string
  showReviews: boolean
  reviewsHidden: boolean
  taskCount: number
  reviewCount: number
  runningAgents: number
  collapsedIds: ReadonlySet<string>
  focusedIndex: number
  rows: readonly NavRow[]
  navGroups: readonly NavGroup[]
}

export type AttentionOverviewAction =
  | { kind: 'cycle-lane' }
  | { kind: 'toggle-reviews' }
  | { kind: 'toggle-group'; id: string }
  | { kind: 'focus'; index: number }
  | { kind: 'activate'; index: number }

type Key = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>

/** One instance per open dialog. start is idempotent; dispose is final and ignores late reads.
 * Subscribers receive complete views, with a navigable cursor, after every interaction.
 * Read failures retain the last good view. Persistence failures retain local preferences.
 * handleKey reports ownership; the caller handles DOM events, focus and scrolling.
 */
export interface AttentionOverviewInteraction extends Readable<AttentionOverviewView> {
  start(): Promise<void>
  refresh(): Promise<void>
  dispatch(action: AttentionOverviewAction): void
  handleKey(key: Key): boolean
  dispose(): void
}

function parseJson(raw: string | null): unknown {
  try { return raw ? JSON.parse(raw) : null } catch { return null }
}

function rowKey(row: NavRow): string {
  switch (row.kind) {
    case 'header': return `header:${row.group.id}`
    case 'task': return `task:${row.item.task.id}`
    case 'review': return `review:${row.pr.id}`
  }
}

export function createAttentionOverviewInteraction(
  source: AttentionOverviewSource,
  onIntent: (intent: AttentionOverviewIntent) => void,
): AttentionOverviewInteraction {
  let overview: AttentionOverview | null = null
  let activeId: string | null = null
  let loading = true
  let error: string | null = null
  let preferenceError: string | null = null
  let taskLane: BoardFilter = 'focus' // Intentionally resets on every open.
  let showReviews = true
  let collapsedIds = new Set<string>()
  let focusedIndex = 0
  let rows: NavRow[] = []
  let generation = 0
  let disposed = false
  let initialLoad: Promise<void> | undefined
  let unsubscribe: (() => void) | undefined
  let refreshPending = false
  let filtersChanged = false
  let collapseChanged = false
  const pendingWrites = new Map<string, Promise<void>>()

  function view(): AttentionOverviewView {
    const groups: DisplayGroup[] = []
    for (const group of overview?.groups ?? []) {
      const taskItems = group.tasksByLane[taskLane]
      const reviewPrs = showReviews ? group.reviewPrs : []
      if (taskItems.length === 0 && reviewPrs.length === 0) continue
      groups.push({ id: group.project.id, projectId: group.project.id, name: group.project.name,
        isActive: group.project.id === activeId, taskItems, reviewPrs })
    }
    if (showReviews && overview?.otherReviewPrs.length) {
      groups.push({ id: OTHER_ID, projectId: null, name: 'Other repositories', isActive: false,
        taskItems: [], reviewPrs: overview.otherReviewPrs })
    }
    rows = []
    const navGroups: NavGroup[] = []
    for (const group of groups) {
      const navGroup: NavGroup = { group, headerIndex: rows.length, items: [] }
      rows.push({ kind: 'header', group })
      if (!collapsedIds.has(group.id)) {
        const items: NavRow[] = [
          ...group.taskItems.map((item): NavRow => ({ kind: 'task', group, item })),
          ...group.reviewPrs.map((pr): NavRow => ({ kind: 'review', group, pr })),
        ]
        for (const row of items) {
          navGroup.items.push({ row, index: rows.length })
          rows.push(row)
        }
      }
      navGroups.push(navGroup)
    }
    focusedIndex = clampFocus(rows, focusedIndex, collapsedIds)
    return { loading, error, preferenceError, taskLane, laneLabel: TASK_LANE_LABELS[taskLane],
      showReviews, reviewsHidden: !showReviews && (overview?.totalReviewPrs ?? 0) > 0,
      taskCount: overview?.totalTasksByLane[taskLane] ?? 0, reviewCount: overview?.totalReviewPrs ?? 0,
      runningAgents: overview?.totalRunningAgents ?? 0, collapsedIds, focusedIndex, rows, navGroups }
  }

  const store = writable(view())
  function publish(): void { if (!disposed) store.set(view()) }

  function persist(key: string, value: string): void {
    // Serialize each preference so a slow earlier write cannot overwrite a later choice.
    const previous = pendingWrites.get(key) ?? Promise.resolve()
    const write = previous.then(() => source.writeConfig(key, value)).then(() => {
      if (!disposed) { preferenceError = null; publish() }
    }).catch((cause: unknown) => {
      if (!disposed) { preferenceError = String(cause); publish() }
    })
    pendingWrites.set(key, write)
  }

  function toggleGroup(id: string): void {
    const headerIndex = headerIndexForGroup(rows, id)
    if (headerIndex < 0) return
    collapseChanged = true
    collapsedIds = new Set(collapsedIds)
    if (collapsedIds.has(id)) {
      collapsedIds.delete(id)
      focusedIndex = headerIndex + 1
    } else {
      collapsedIds.add(id)
      focusedIndex = headerIndex
    }
    persist(COLLAPSED_CONFIG_KEY, JSON.stringify([...collapsedIds]))
    publish()
  }

  function dispatch(action: AttentionOverviewAction): void {
    if (disposed) return
    switch (action.kind) {
      case 'cycle-lane':
        taskLane = TASK_LANES[(TASK_LANES.indexOf(taskLane) + 1) % TASK_LANES.length]
        focusedIndex = 0
        break
      case 'toggle-reviews':
        filtersChanged = true
        showReviews = !showReviews
        persist(FILTERS_CONFIG_KEY, JSON.stringify({ showReviews }))
        break
      case 'toggle-group':
        toggleGroup(action.id)
        return
      case 'focus':
        focusedIndex = action.index
        break
      case 'activate': {
        const row = rows[action.index]
        if (!row) return
        if (row.kind === 'header') { toggleGroup(row.group.id); return }
        focusedIndex = action.index
        publish()
        onIntent(row.kind === 'task' ? { kind: 'task', task: row.item.task }
          : { kind: 'review', pr: row.pr, projectId: row.group.projectId })
        return
      }
    }
    publish()
  }

  function handleKey(key: Key): boolean {
    if (disposed || loading) return false
    if (!key.metaKey && !key.ctrlKey && !key.altKey) {
      if (key.key.toLowerCase() === 'r') { dispatch({ kind: 'toggle-reviews' }); return true }
      if (key.key.toLowerCase() === 't') { dispatch({ kind: 'cycle-lane' }); return true }
    }
    const row = rows[focusedIndex]
    switch (key.key) {
      case 'ArrowDown': case 'j':
        focusedIndex = stepFocus(rows, focusedIndex, 1, collapsedIds)
        break
      case 'ArrowUp': case 'k':
        focusedIndex = stepFocus(rows, focusedIndex, -1, collapsedIds)
        break
      case 'ArrowLeft': case 'h':
        if (row && row.kind !== 'header') toggleGroup(row.group.id)
        break
      case 'ArrowRight': case 'l':
        if (row?.kind === 'header' && collapsedIds.has(row.group.id)) toggleGroup(row.group.id)
        break
      default: return false // Row activation and Modal's Escape handling stay with the DOM.
    }
    publish()
    return true
  }

  async function refresh(): Promise<void> {
    if (disposed) return
    if (loading) { refreshPending = true; return }
    const request = ++generation
    try {
      const gathered = await source.load()
      if (disposed || request !== generation) return
      const previousKey = rows[focusedIndex] ? rowKey(rows[focusedIndex]) : null
      const previousIndex = focusedIndex
      overview = gathered.overview
      activeId = gathered.activeId
      error = null
      view()
      focusedIndex = resolveFocusedIndex(previousKey, rows.map(rowKey), previousIndex)
      publish()
    } catch (cause) {
      if (!disposed && request === generation) { error = String(cause); publish() }
    }
  }

  async function loadInitial(): Promise<void> {
    const request = ++generation
    try {
      const [gathered, collapsedRaw, filtersRaw] = await Promise.all([
        source.load(), source.readConfig(COLLAPSED_CONFIG_KEY), source.readConfig(FILTERS_CONFIG_KEY),
      ])
      if (disposed || request !== generation) return
      overview = gathered.overview
      activeId = gathered.activeId
      const collapsed = parseJson(collapsedRaw)
      if (!collapseChanged && Array.isArray(collapsed) && collapsed.every((id) => typeof id === 'string')) {
        collapsedIds = new Set(collapsed)
      }
      const filters = parseJson(filtersRaw)
      if (!filtersChanged && filters && typeof filters === 'object' && 'showReviews' in filters && typeof filters.showReviews === 'boolean') {
        showReviews = filters.showReviews
      }
      view()
      focusedIndex = initialFocusIndex(rows, activeId, collapsedIds)
    } catch (cause) {
      if (!disposed && request === generation) error = String(cause)
    } finally {
      if (!disposed && request === generation) {
        loading = false
        publish()
        if (refreshPending) { refreshPending = false; await refresh() }
      }
    }
  }

  return {
    subscribe: store.subscribe,
    start() {
      if (disposed) return Promise.resolve()
      if (!initialLoad) {
        initialLoad = loadInitial()
        unsubscribe = source.subscribeChanges(() => { void refresh() })
      }
      return initialLoad
    },
    refresh, dispatch, handleKey,
    dispose() {
      disposed = true
      generation++
      unsubscribe?.()
      unsubscribe = undefined
    },
  }
}
