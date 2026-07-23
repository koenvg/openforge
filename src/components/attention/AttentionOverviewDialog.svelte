<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { get } from 'svelte/store'
  import Modal from '../shared/ui/Modal.svelte'
  import { projects, activeProjectId, reviewPrs, globalExcludedPrRepos, ticketPrs, hiddenProjectIds, attentionCountByProject } from '../../lib/stores'
  import { getAllTasks, getLatestSessions, getProjectConfig, getConfig, setConfig } from '../../lib/ipc'
  import { loadOutOfFocusTaskIds, loadFocusFilterStates, DEFAULT_FOCUS_STATES } from '../../lib/boardFilters'
  import { buildAttentionOverview } from '../../lib/attentionOverview'
  import { resolveFocusedIndex, subscribeDebounced } from '../../lib/attentionOverviewRefresh'
  import type { AttentionOverview, AttentionFocusTask } from '../../lib/attentionOverview'
  import type { ReviewPullRequest, Task } from '../../lib/types'
  import type { TaskState } from '../../lib/taskState'
  import { TASK_STATE_COMPACT_LABELS, getTaskReasonText } from '../../lib/taskStatePresentation'

  interface Props {
    onClose: () => void
    onOpenTask: (task: Task) => void
    onOpenPr: (pr: ReviewPullRequest, projectId: string | null) => void
  }

  let { onClose, onOpenTask, onOpenPr }: Props = $props()

  const COLLAPSED_CONFIG_KEY = 'attention_overview_collapsed_projects'
  const OTHER_ID = '__other__'
  // Coalesce store-change bursts (streaming agents, PR polls) into one reload while open.
  const REFRESH_DEBOUNCE_MS = 250

  interface DisplayGroup {
    id: string
    name: string
    isActive: boolean
    focusTasks: AttentionFocusTask[]
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

  let loading = $state(true)
  let overview = $state<AttentionOverview | null>(null)
  let collapsedIds = $state<Set<string>>(new Set())
  let focusedIndex = $state(0)
  let activeId = $state<string | null>(null)
  let bodyEl = $state<HTMLElement | null>(null)

  let displayGroups = $derived.by<DisplayGroup[]>(() => {
    if (!overview) return []
    const groups: DisplayGroup[] = overview.groups.map((group) => ({
      id: group.project.id,
      name: group.project.name,
      isActive: group.project.id === activeId,
      focusTasks: group.focusTasks,
      reviewPrs: group.reviewPrs,
    }))
    if (overview.otherReviewPrs.length > 0) {
      groups.push({
        id: OTHER_ID,
        name: 'Other repositories',
        isActive: false,
        focusTasks: [],
        reviewPrs: overview.otherReviewPrs,
      })
    }
    return groups
  })

  let rows = $derived.by<NavRow[]>(() => {
    const out: NavRow[] = []
    for (const group of displayGroups) {
      out.push({ kind: 'header', group })
      if (!collapsedIds.has(group.id)) {
        for (const item of group.focusTasks) out.push({ kind: 'task', group, item })
        for (const pr of group.reviewPrs) out.push({ kind: 'review', group, pr })
      }
    }
    return out
  })

  let navGroups = $derived.by<NavGroup[]>(() => {
    const groups: NavGroup[] = []
    let current: NavGroup | null = null
    rows.forEach((row, index) => {
      if (row.kind === 'header') {
        current = { group: row.group, headerIndex: index, items: [] }
        groups.push(current)
      } else if (current) {
        current.items.push({ row, index })
      }
    })
    return groups
  })

  function parseCollapsed(raw: string | null): Set<string> {
    if (!raw) return new Set()
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')) {
        return new Set(parsed)
      }
    } catch { /* ignore malformed config */ }
    return new Set()
  }

  async function persistCollapsed(ids: Set<string>): Promise<void> {
    try {
      await setConfig(COLLAPSED_CONFIG_KEY, JSON.stringify([...ids]))
    } catch (e) {
      console.error('Failed to persist attention-overview collapse state:', e)
    }
  }

  function setCollapsed(id: string, collapsed: boolean): void {
    const next = new Set(collapsedIds)
    if (collapsed) {
      next.add(id)
    } else {
      next.delete(id)
    }
    collapsedIds = next
    void persistCollapsed(next)
  }

  function headerIndexForGroup(id: string): number {
    return rows.findIndex((row) => row.kind === 'header' && row.group.id === id)
  }

  // Stable logical identity for a row, so the cursor can follow the same task/PR/header
  // across a refresh even when its index shifts.
  function rowKey(row: NavRow): string {
    switch (row.kind) {
      case 'header': return `header:${row.group.id}`
      case 'task': return `task:${row.item.task.id}`
      case 'review': return `review:${row.pr.id}`
    }
  }

  // Row-level keyboard activation (Enter / Space). Navigation keys are left to
  // bubble up to the modal-level handler; only activation is captured here.
  function rowKeydown(e: KeyboardEvent, action: () => void): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      action()
    }
  }

  function onKeydown(e: KeyboardEvent): boolean | void {
    if (loading) return
    const row = rows[focusedIndex]

    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        e.preventDefault()
        focusedIndex = Math.min(rows.length - 1, focusedIndex + 1)
        return true
      case 'ArrowUp':
      case 'k':
        e.preventDefault()
        focusedIndex = Math.max(0, focusedIndex - 1)
        return true
      case 'ArrowLeft':
      case 'h':
        e.preventDefault()
        if (!row) return true
        if (row.kind === 'header') {
          setCollapsed(row.group.id, true)
        } else {
          // Collapse the whole project and move the cursor up to its header.
          setCollapsed(row.group.id, true)
          const headerIndex = headerIndexForGroup(row.group.id)
          if (headerIndex >= 0) focusedIndex = headerIndex
        }
        return true
      case 'ArrowRight':
      case 'l':
        e.preventDefault()
        if (row?.kind === 'header' && collapsedIds.has(row.group.id)) {
          setCollapsed(row.group.id, false)
        }
        return true
    }
    // Enter/Space are handled per-row; Escape and everything else fall through
    // to the Modal (Escape closes).
  }

  function focusRow(index: number): void {
    focusedIndex = index
  }

  // Read the current stores + fresh IPC snapshots and assemble the overview. Pure gather
  // step: it does not touch component state, so both the initial load and the live refresh
  // can share it and apply the result differently (initial resets focus, refresh preserves it).
  async function gatherOverview(): Promise<{ overview: AttentionOverview; activeId: string | null }> {
    const projectList = get(projects)
    const nextActiveId = get(activeProjectId)

    const allTasks = await getAllTasks()
    const doingIds = allTasks.filter((task) => task.status === 'doing').map((task) => task.id)
    const sessionList = doingIds.length > 0 ? await getLatestSessions(doingIds) : []
    const sessions = new Map(sessionList.map((session) => [session.ticket_id, session]))

    const resolvedRepoByProject = new Map<string, string | null>()
    const outOfFocusByProject = new Map<string, Set<string>>()
    const focusStatesByProject = new Map<string, TaskState[]>()
    await Promise.all(
      projectList.map(async (project) => {
        const [repoRaw, outOfFocus, focusStates] = await Promise.all([
          getProjectConfig(project.id, 'resolved_repo').catch(() => null),
          loadOutOfFocusTaskIds(project.id).catch(() => new Set<string>()),
          loadFocusFilterStates(project.id).catch(() => DEFAULT_FOCUS_STATES),
        ])
        resolvedRepoByProject.set(
          project.id,
          typeof repoRaw === 'string' && repoRaw.includes('/') ? repoRaw : null,
        )
        if (outOfFocus.size > 0) outOfFocusByProject.set(project.id, outOfFocus)
        focusStatesByProject.set(project.id, focusStates)
      }),
    )

    return {
      overview: buildAttentionOverview({
        projects: projectList,
        allTasks,
        sessions,
        ticketPrs: get(ticketPrs),
        outOfFocusByProject,
        focusStatesByProject,
        reviewPrs: get(reviewPrs),
        excludedRepos: get(globalExcludedPrRepos),
        resolvedRepoByProject,
        hiddenProjectIds: get(hiddenProjectIds),
      }),
      activeId: nextActiveId,
    }
  }

  async function loadData(): Promise<void> {
    loading = true
    try {
      const collapsedRawPromise = getConfig(COLLAPSED_CONFIG_KEY)
      const gathered = await gatherOverview()
      overview = gathered.overview
      activeId = gathered.activeId
      collapsedIds = parseCollapsed(await collapsedRawPromise)

      await tick()
      // Open scrolled to the project the user is currently viewing.
      const activeHeaderIndex = activeId ? headerIndexForGroup(activeId) : -1
      focusedIndex = activeHeaderIndex >= 0 ? activeHeaderIndex : 0
    } finally {
      loading = false
    }
  }

  // Re-assemble the overview in place while the dialog stays open, so a newly idle task
  // or a freshly-arrived review request shows up without a close/reopen. The cursor stays
  // on the same logical row and the collapsed layout is preserved (we deliberately keep the
  // in-memory collapsedIds rather than re-reading config) so nothing jumps under the user.
  async function refreshData(): Promise<void> {
    if (loading) return // initial load in flight will produce fresh data anyway
    const focusedRow = rows[focusedIndex]
    const previousKey = focusedRow ? rowKey(focusedRow) : null
    const previousIndex = focusedIndex

    const gathered = await gatherOverview()
    overview = gathered.overview
    activeId = gathered.activeId

    await tick()
    focusedIndex = resolveFocusedIndex(previousKey, rows.map(rowKey), previousIndex)
  }

  // Defensive: if the row list ever shrinks out from under the cursor, keep the
  // index in range (converges immediately; only writes when out of bounds).
  $effect(() => {
    if (rows.length > 0 && focusedIndex > rows.length - 1) {
      focusedIndex = rows.length - 1
    }
  })

  // Keep the focused row scrolled into view and holding DOM focus as the cursor
  // moves, so Enter/Space activate the highlighted row.
  $effect(() => {
    const index = focusedIndex
    if (!bodyEl) return
    const el = bodyEl.querySelector<HTMLElement>(`[data-attn-row="${index}"]`)
    if (!el) return
    el.scrollIntoView?.({ block: 'nearest' })
    if (document.activeElement !== el) el.focus?.({ preventScroll: true })
  })

  onMount(() => {
    void loadData()
    // Keep the open dialog live: any change to the data feeding the overview triggers a
    // debounced refresh. attentionCountByProject is the cross-project "task attention
    // changed" heartbeat (the data orchestrator recomputes it on agent events), so an agent
    // finishing — even in a non-active project — surfaces here; reviewPrs covers newly
    // arrived review requests. Returned teardown unsubscribes + cancels on dialog close.
    return subscribeDebounced(
      [projects, reviewPrs, ticketPrs, hiddenProjectIds, globalExcludedPrRepos, activeProjectId, attentionCountByProject],
      () => { void refreshData() },
      REFRESH_DEBOUNCE_MS,
    )
  })

  function dotClass(state: TaskState): string {
    switch (state) {
      case 'active': return 'bg-success animate-pulse'
      case 'needs-input':
      case 'unaddressed-comments': return 'bg-warning'
      case 'failed':
      case 'ci-failed':
      case 'changes-requested':
      case 'merge-conflict': return 'bg-error'
      case 'agent-done':
      case 'ready-to-merge':
      case 'ready-to-enqueue':
      case 'pr-queued': return 'bg-info'
      default: return 'bg-base-content/30'
    }
  }

  function relTime(seconds: number): string {
    if (!seconds) return ''
    const delta = Math.max(0, Date.now() / 1000 - seconds)
    if (delta < 3600) return `${Math.max(1, Math.round(delta / 60))}m ago`
    if (delta < 86400) return `${Math.round(delta / 3600)}h ago`
    return `${Math.round(delta / 86400)}d ago`
  }

  function taskTitle(task: Task): string {
    return task.title?.trim() || task.initial_prompt || 'Untitled task'
  }
</script>

<Modal
  onClose={onClose}
  maxWidth="720px"
  ariaLabel="Attention overview"
  showHeader={false}
  onKeydown={onKeydown}
  boxClass="max-h-[82vh]"
>
  <div class="flex flex-col min-h-0 max-h-[82vh]">
    <!-- Header -->
    <div class="flex items-center gap-3.5 px-5 py-4 border-b border-base-300">
      <div class="w-9 h-9 rounded-xl grid place-items-center shrink-0 bg-primary/15 text-primary">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" />
          <path d="M12 1.5V4M12 20v2.5M1.5 12H4M20 12h2.5" />
        </svg>
      </div>
      <div class="flex flex-col min-w-0">
        <h2 class="text-base font-semibold text-base-content m-0 leading-tight">Needs your attention</h2>
      </div>
      <div class="flex-1"></div>
      <button class="btn btn-ghost btn-xs shrink-0" aria-label="Close dialog" type="button" onclick={onClose}>✕</button>
    </div>

    <!-- Body -->
    <div bind:this={bodyEl} class="overflow-y-auto flex-1 min-h-0 px-3 py-2">
      {#if loading}
        <div class="flex flex-col items-center justify-center gap-3 py-16 text-base-content/50 text-sm">
          <span class="loading loading-spinner loading-md text-primary"></span>
          <span>Gathering what needs your attention…</span>
        </div>
      {:else if navGroups.length === 0}
        <div class="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <span class="text-2xl">🎉</span>
          <p class="text-sm font-medium text-base-content m-0">You're all caught up</p>
          <p class="text-xs text-base-content/50 m-0">No focus tasks or review requests need you right now.</p>
        </div>
      {:else}
        {#each navGroups as ng (ng.group.id)}
          {@const collapsed = collapsedIds.has(ng.group.id)}
          <div class="py-1">
            <!-- Project header (selectable, collapsible) -->
            <div
              role="button"
              tabindex="0"
              data-attn-row={ng.headerIndex}
              aria-expanded={!collapsed}
              class="flex items-center gap-2.5 px-2 py-2 rounded-lg cursor-pointer border border-transparent transition-colors
                {focusedIndex === ng.headerIndex ? 'bg-base-200 border-primary ring-1 ring-primary' : 'hover:bg-base-200/70'}"
              onclick={() => { focusRow(ng.headerIndex); setCollapsed(ng.group.id, !collapsed) }}
              onkeydown={(e) => rowKeydown(e, () => setCollapsed(ng.group.id, !collapsed))}
              onfocus={() => focusRow(ng.headerIndex)}
            >
              <span class="w-4 grid place-items-center text-base-content/40 transition-transform {collapsed ? '' : 'rotate-90'}">
                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4z" /></svg>
              </span>
              <span class="text-sm font-semibold text-base-content">{ng.group.name}</span>
              {#if ng.group.isActive}
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-semibold tracking-wide shrink-0">viewing</span>
              {/if}
              <!-- Count badges only when collapsed -->
              {#if collapsed}
                <span class="ml-auto flex items-center gap-1.5 shrink-0">
                  {#if ng.group.focusTasks.length > 0}
                    <span class="badge badge-ghost badge-sm">{ng.group.focusTasks.length} focus</span>
                  {/if}
                  {#if ng.group.reviewPrs.length > 0}
                    <span class="badge badge-error badge-sm">{ng.group.reviewPrs.length} review{ng.group.reviewPrs.length > 1 ? 's' : ''}</span>
                  {/if}
                </span>
              {/if}
            </div>

            <!-- Nested items with a guide rail -->
            {#if !collapsed}
              <div class="ml-3.5 pl-4 border-l border-base-300 flex flex-col gap-0.5 mt-0.5">
                {#if ng.group.focusTasks.length > 0}
                  <div class="text-[10px] uppercase tracking-wider text-base-content/40 font-semibold px-2.5 pt-2 pb-1">Focus</div>
                {/if}
                {#each ng.items.filter((it) => it.row.kind === 'task') as it (it.row.kind === 'task' ? it.row.item.task.id : it.index)}
                  {#if it.row.kind === 'task'}
                    {@const task = it.row.item.task}
                    {@const state = it.row.item.state}
                    <div
                      role="button"
                      tabindex="0"
                      data-attn-row={it.index}
                      class="flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer border border-transparent transition-colors
                        {focusedIndex === it.index ? 'bg-base-200 border-primary ring-1 ring-primary' : 'hover:bg-base-200/70'}"
                      onclick={() => { focusRow(it.index); onOpenTask(task) }}
                      onkeydown={(e) => rowKeydown(e, () => onOpenTask(task))}
                      onfocus={() => focusRow(it.index)}
                    >
                      <span class="w-2.5 h-2.5 rounded-full shrink-0 {dotClass(state)}"></span>
                      <div class="min-w-0 flex-1 flex flex-col gap-0.5">
                        <span class="text-sm text-base-content truncate">{taskTitle(task)}</span>
                        <span class="text-[11px] text-base-content/45 truncate">
                          {TASK_STATE_COMPACT_LABELS[state] ?? state} · {getTaskReasonText(state, it.row.item.prs)}
                        </span>
                      </div>
                      <span class="text-base-content/30 shrink-0">›</span>
                    </div>
                  {/if}
                {/each}

                {#if ng.group.reviewPrs.length > 0}
                  <div class="text-[10px] uppercase tracking-wider text-base-content/40 font-semibold px-2.5 pt-2 pb-1">Review requests</div>
                {/if}
                {#each ng.items.filter((it) => it.row.kind === 'review') as it (it.row.kind === 'review' ? it.row.pr.id : it.index)}
                  {#if it.row.kind === 'review'}
                    {@const pr = it.row.pr}
                    {@const prProjectId = ng.group.id === OTHER_ID ? null : ng.group.id}
                    <div
                      role="button"
                      tabindex="0"
                      data-attn-row={it.index}
                      class="flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer border border-transparent transition-colors
                        {focusedIndex === it.index ? 'bg-base-200 border-primary ring-1 ring-primary' : 'hover:bg-base-200/70'}"
                      onclick={() => { focusRow(it.index); onOpenPr(pr, prProjectId) }}
                      onkeydown={(e) => rowKeydown(e, () => onOpenPr(pr, prProjectId))}
                      onfocus={() => focusRow(it.index)}
                    >
                      <span class="w-4 grid place-items-center shrink-0 text-success">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 3.5a2 2 0 10-2.45 1.95v5.1a2 2 0 102 .95V5.45A2 2 0 0011.5 3.5zM3.5 1.5a2 2 0 00-1 3.73v5.54a2 2 0 101 0V5.23a2 2 0 00-1-3.73z" /></svg>
                      </span>
                      <div class="min-w-0 flex-1 flex flex-col gap-0.5">
                        <span class="text-sm text-base-content truncate">{pr.title}</span>
                        <span class="text-[11px] text-base-content/45 truncate">
                          #{pr.number} {pr.repo_owner}/{pr.repo_name} · {pr.user_login}
                          · <span class="text-success">+{pr.additions}</span> <span class="text-error">−{pr.deletions}</span>
                          · {pr.changed_files} file{pr.changed_files === 1 ? '' : 's'}
                          {#if relTime(pr.updated_at)} · {relTime(pr.updated_at)}{/if}
                        </span>
                      </div>
                      <span class="text-base-content/30 shrink-0">›</span>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    <!-- Footer hints -->
    <div class="flex items-center gap-4 px-4 py-2.5 border-t border-base-300 bg-base-200/40 text-[11px] text-base-content/40">
      <span><kbd class="kbd kbd-xs">↑</kbd><kbd class="kbd kbd-xs">↓</kbd> navigate</span>
      <span><kbd class="kbd kbd-xs">←</kbd> collapse</span>
      <span><kbd class="kbd kbd-xs">→</kbd> expand</span>
      <span><kbd class="kbd kbd-xs">↵</kbd> open</span>
      <span><kbd class="kbd kbd-xs">esc</kbd> close</span>
    </div>
  </div>
</Modal>
