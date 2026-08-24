<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { get } from 'svelte/store'
  import { Bot, GitPullRequest } from '@lucide/svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import { projects, activeProjectId, reviewPrs, globalExcludedPrRepos, ticketPrs, hiddenProjectIds, attentionCountByProject } from '../../lib/stores'
  import { getAllTasks, getTaskAttention, getSetAsideTasks, getProjectConfig, getConfig, setConfig } from '../../lib/ipc'
  import { buildAttentionOverview } from '../../lib/attentionOverview'
  import { resolveFocusedIndex, subscribeDebounced } from '../../lib/attentionOverviewRefresh'
  import { stepFocus, initialFocusIndex, clampFocus, headerIndexForGroup } from '../../lib/attentionOverviewNav'
  import type { AttentionOverview, AttentionFocusTask } from '../../lib/attentionOverview'
  import type { ReviewPullRequest, Task } from '../../lib/types'
  import { TASK_STATE_COMPACT_LABELS } from '../../lib/taskStatePresentation'

  interface Props {
    onClose: () => void
    onOpenTask: (task: Task) => void
    onOpenPr: (pr: ReviewPullRequest, projectId: string | null) => void
  }

  let { onClose, onOpenTask, onOpenPr }: Props = $props()

  const COLLAPSED_CONFIG_KEY = 'attention_overview_collapsed_projects'
  const FILTERS_CONFIG_KEY = 'attention_overview_filters'
  const OTHER_ID = '__other__'
  const CHIP_ACTIVE = 'border-primary/40 bg-primary/10 text-primary'
  const CHIP_NEUTRAL = 'border-base-300 bg-base-200/60 text-base-content/70 hover:text-base-content'
  const CHIP_MUTED = 'border-base-300 bg-base-200/40 text-base-content/40 hover:text-base-content/70'
  // Coalesce store-change bursts (streaming agents, PR polls) into one reload while open.
  const REFRESH_DEBOUNCE_MS = 250

  interface DisplayGroup {
    id: string
    name: string
    isActive: boolean
    /** Whichever task lane `E` currently selects, already filtered by `T`. */
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

  /** Which lane the task rows come from. Both are loaded; `E` picks between them. */
  type TaskLane = 'focus' | 'set-aside'

  let loading = $state(true)
  let overviewRequestGeneration = 0
  let overview = $state<AttentionOverview | null>(null)
  let collapsedIds = $state<Set<string>>(new Set())
  let focusedIndex = $state(0)
  let activeId = $state<string | null>(null)
  let bodyEl = $state<HTMLElement | null>(null)
  let showReviews = $state(true)
  // Deliberately not persisted: the dialog is "Needs your attention" first, so it always
  // reopens on the focus lane rather than in whatever mode it was last left in.
  let taskLane = $state<TaskLane>('focus')

  let taskCount = $derived(
    (taskLane === 'set-aside' ? overview?.totalSetAsideTasks : overview?.totalFocusTasks) ?? 0,
  )
  let reviewCount = $derived(overview?.totalReviewPrs ?? 0)

  // R is hiding reviews that do exist. Drives the empty state, so an empty list never claims
  // "all caught up" when the filter is what emptied it.
  let reviewsHidden = $derived(!showReviews && reviewCount > 0)

  let displayGroups = $derived.by<DisplayGroup[]>(() => {
    if (!overview) return []
    const groups: DisplayGroup[] = []
    for (const group of overview.groups) {
      const taskItems = taskLane === 'set-aside' ? group.setAsideTasks : group.focusTasks
      const reviewPrs = showReviews ? group.reviewPrs : []
      // A project only earns a header when the current filters leave it something to show.
      if (taskItems.length === 0 && reviewPrs.length === 0) continue
      groups.push({
        id: group.project.id,
        name: group.project.name,
        isActive: group.project.id === activeId,
        taskItems,
        reviewPrs,
      })
    }
    if (showReviews && overview.otherReviewPrs.length > 0) {
      groups.push({
        id: OTHER_ID,
        name: 'Other repositories',
        isActive: false,
        taskItems: [],
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
        for (const item of group.taskItems) out.push({ kind: 'task', group, item })
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

  function applyStoredFilters(raw: string | null): void {
    if (!raw) return
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.showReviews === 'boolean') showReviews = parsed.showReviews
    } catch { /* ignore malformed config */ }
  }

  async function persistFilters(): Promise<void> {
    try {
      await setConfig(FILTERS_CONFIG_KEY, JSON.stringify({ showReviews }))
    } catch (e) {
      console.error('Failed to persist attention-overview filters:', e)
    }
  }

  function toggleReviews(): void {
    showReviews = !showReviews
    void persistFilters()
  }

  /** Swap which task lane the list shows. The two lanes are exclusive; there is no "both". */
  function toggleLane(): void {
    taskLane = taskLane === 'set-aside' ? 'focus' : 'set-aside'
    focusedIndex = 0
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

  // Collapse a project and park the cursor on its (now reachable) header, so ←/→
  // round-trip: the header index is stable across this toggle because a group's
  // items sit *after* its header.
  function collapseGroup(id: string): void {
    const headerIndex = headerIndexForGroup(rows, id)
    setCollapsed(id, true)
    if (headerIndex >= 0) focusedIndex = headerIndex
  }

  // Expand a project and drop the cursor onto its first item (header index + 1).
  function expandGroup(id: string): void {
    const headerIndex = headerIndexForGroup(rows, id)
    setCollapsed(id, false)
    if (headerIndex >= 0) focusedIndex = headerIndex + 1
  }

  function toggleGroup(id: string): void {
    if (collapsedIds.has(id)) expandGroup(id)
    else collapseGroup(id)
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

    // Filter shortcuts, unmodified only, so ⌘R stays reload. Case-insensitive, so Shift+R
    // works like R.
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      switch (e.key.toLowerCase()) {
        case 'r':
          e.preventDefault()
          toggleReviews()
          return true
        case 'e':
          e.preventDefault()
          toggleLane()
          return true
      }
    }

    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        // ↑/↓ move between tasks, reviews, and collapsed-project headers only;
        // an expanded project's header is skipped (see attentionOverviewNav).
        e.preventDefault()
        focusedIndex = stepFocus(rows, focusedIndex, 1, collapsedIds)
        return true
      case 'ArrowUp':
      case 'k':
        e.preventDefault()
        focusedIndex = stepFocus(rows, focusedIndex, -1, collapsedIds)
        return true
      case 'ArrowLeft':
      case 'h':
        // Collapse the focused item's project; on a collapsed header there is
        // nothing left to collapse.
        e.preventDefault()
        if (row && row.kind !== 'header') collapseGroup(row.group.id)
        return true
      case 'ArrowRight':
      case 'l':
        // Expand a collapsed project's header.
        e.preventDefault()
        if (row?.kind === 'header' && collapsedIds.has(row.group.id)) expandGroup(row.group.id)
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

    const [allTasks, taskAttentionRows, setAsideTaskRows] = await Promise.all([
      getAllTasks(),
      getTaskAttention(),
      getSetAsideTasks(),
    ])

    const resolvedRepoByProject = new Map<string, string | null>()
    await Promise.all(
      projectList.map(async (project) => {
        const repoRaw = await getProjectConfig(project.id, 'resolved_repo').catch(() => null)
        resolvedRepoByProject.set(
          project.id,
          typeof repoRaw === 'string' && repoRaw.includes('/') ? repoRaw : null,
        )
      }),
    )

    return {
      overview: buildAttentionOverview({
        projects: projectList,
        allTasks,
        taskAttentionRows,
        setAsideTaskRows,
        reviewPrs: get(reviewPrs),
        excludedRepos: get(globalExcludedPrRepos),
        resolvedRepoByProject,
        hiddenProjectIds: get(hiddenProjectIds),
      }),
      activeId: nextActiveId,
    }
  }

  async function loadData(): Promise<void> {
    const generation = ++overviewRequestGeneration
    loading = true
    try {
      const collapsedRawPromise = getConfig(COLLAPSED_CONFIG_KEY)
      const filtersRawPromise = getConfig(FILTERS_CONFIG_KEY)
      const gathered = await gatherOverview()
      const collapsed = parseCollapsed(await collapsedRawPromise)
      const filtersRaw = await filtersRawPromise
      if (generation !== overviewRequestGeneration) return
      overview = gathered.overview
      activeId = gathered.activeId
      collapsedIds = collapsed
      applyStoredFilters(filtersRaw)

      await tick()
      if (generation !== overviewRequestGeneration) return
      // Open on the first task/review of the project the user is currently viewing.
      focusedIndex = initialFocusIndex(rows, activeId, collapsedIds)
    } finally {
      if (generation === overviewRequestGeneration) loading = false
    }
  }

  // Re-assemble the overview in place while the dialog stays open, so a newly idle task
  // or a freshly-arrived review request shows up without a close/reopen. The cursor stays
  // on the same logical row and the collapsed layout is preserved (we deliberately keep the
  // in-memory collapsedIds rather than re-reading config) so nothing jumps under the user.
  async function refreshData(): Promise<void> {
    if (loading) return // initial load in flight will produce fresh data anyway
    const generation = ++overviewRequestGeneration
    const focusedRow = rows[focusedIndex]
    const previousKey = focusedRow ? rowKey(focusedRow) : null
    const previousIndex = focusedIndex

    const gathered = await gatherOverview()
    if (generation !== overviewRequestGeneration) return
    overview = gathered.overview
    activeId = gathered.activeId

    await tick()
    if (generation !== overviewRequestGeneration) return
    focusedIndex = resolveFocusedIndex(previousKey, rows.map(rowKey), previousIndex)
  }

  // Defensive: if the row list changes under the cursor (e.g. a project was
  // collapsed), keep it on a navigable row. Converges in one step, so it only
  // writes when the cursor actually needs to move.
  $effect(() => {
    if (rows.length === 0) return
    const next = clampFocus(rows, focusedIndex, collapsedIds)
    if (next !== focusedIndex) focusedIndex = next
  })

  // Keep the focused row scrolled into view and holding DOM focus as the cursor
  // moves, so Enter/Space activate the highlighted row.
  //
  // `loading` is read on purpose. The initial load picks the cursor row while the body still
  // shows the spinner, so this effect finds no element and bails; without that dependency it
  // would never re-run for an unchanged index and the opening row would look highlighted but
  // hold no DOM focus, leaving Enter dead until the user nudged the cursor off and back.
  $effect(() => {
    const index = focusedIndex
    if (loading || !bodyEl) return
    const el = bodyEl.querySelector<HTMLElement>(`[data-attn-row="${index}"]`)
    if (!el) return
    el.scrollIntoView?.({ block: 'nearest' })
    if (document.activeElement !== el) el.focus?.({ preventScroll: true })
  })

  /**
   * True when nothing inside the dialog meaningfully holds focus. Removing the focused row
   * (a filter emptied the list, or a refresh dropped that row) leaves focus on `<body>`,
   * outside the modal, so every key the dialog owns stops arriving. `bodyEl` counts as
   * stranded too: it is only ever a parking spot, never a place the user aimed at.
   */
  function focusIsStranded(): boolean {
    const active = document.activeElement
    return !active || active === document.body || !active.isConnected || active === bodyEl
  }

  // Recover from that. Runs whenever the row list changes shape, but only takes focus when it
  // is stranded, so a header chip the user clicked keeps it.
  $effect(() => {
    void rows.length
    if (loading || !bodyEl) return
    if (!focusIsStranded()) return
    const el = bodyEl.querySelector<HTMLElement>(`[data-attn-row="${focusedIndex}"]`)
    ;(el ?? bodyEl).focus?.({ preventScroll: true })
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

  function relTime(seconds: number): string {
    if (!seconds) return ''
    const delta = Math.max(0, Date.now() / 1000 - seconds)
    if (delta < 3600) return `${Math.max(1, Math.round(delta / 60))}m ago`
    if (delta < 86400) return `${Math.round(delta / 3600)}h ago`
    return `${Math.round(delta / 86400)}d ago`
  }
</script>

<Modal
  onClose={onClose}
  maxWidth="720px"
  ariaLabel="Attention overview"
  showHeader={false}
  onKeydown={onKeydown}
  boxClass="h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)]!"
>
  <div class="flex flex-col min-h-0 h-full">
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
        {#if taskLane === 'set-aside'}
          <span class="text-[11px] text-base-content/50 leading-tight">Showing set-aside tasks</span>
        {/if}
      </div>
      <div class="flex-1"></div>
      <!-- Two chips, mirroring the two keyboard shortcuts, so the letters are discoverable
           without a legend and the current state is always on screen. R shows or hides the
           reviews. E names the one task lane on screen and swaps to the other. -->
      <div class="flex items-center gap-1.5 shrink-0">
        {#each [
          {
            key: 'E',
            label: taskLane === 'set-aside' ? 'Set aside' : 'Focus',
            count: taskCount,
            pressed: taskLane === 'set-aside',
            // Focus is the default lane, so it reads normal rather than switched-off; only
            // the set-aside detour lights up.
            tone: taskLane === 'set-aside' ? CHIP_ACTIVE : CHIP_NEUTRAL,
            toggle: toggleLane,
          },
          {
            key: 'R',
            label: 'Reviews',
            count: reviewCount,
            pressed: showReviews,
            tone: showReviews ? CHIP_ACTIVE : CHIP_MUTED,
            toggle: toggleReviews,
          },
        ] as chip (chip.key)}
          <button
            type="button"
            aria-pressed={chip.pressed}
            class="flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-lg border text-xs font-medium transition-colors {chip.tone}"
            onclick={chip.toggle}
          >
            <kbd class="kbd kbd-xs">{chip.key}</kbd>
            <span>{chip.label}</span>
            <span class="tabular-nums opacity-70">{chip.count}</span>
          </button>
        {/each}
      </div>
      <button class="btn btn-ghost btn-xs shrink-0" aria-label="Close dialog" type="button" onclick={onClose}>✕</button>
    </div>

    <!-- Body -->
    <!-- tabindex lets the scroll container hold focus while the list is empty, so the
         dialog keeps receiving E and R instead of losing them to <body>. -->
    <div bind:this={bodyEl} tabindex="-1" class="overflow-y-auto flex-1 min-h-0 px-3 py-2 outline-none">
      {#if loading}
        <div class="flex flex-col items-center justify-center gap-3 py-16 text-base-content/50 text-sm">
          <span class="loading loading-spinner loading-md text-primary"></span>
          <span>Gathering what needs your attention…</span>
        </div>
      {:else if navGroups.length === 0}
        <div class="flex flex-col items-center justify-center gap-2 py-16 text-center">
          {#if reviewsHidden}
            <p class="text-sm font-medium text-base-content m-0">Reviews are hidden</p>
            <p class="text-xs text-base-content/50 m-0">Press R to bring them back.</p>
          {:else if taskLane === 'set-aside'}
            <p class="text-sm font-medium text-base-content m-0">Nothing is set aside</p>
            <p class="text-xs text-base-content/50 m-0">No project has a task parked in Out of Focus. Press E to go back.</p>
          {:else}
            <span class="text-2xl">🎉</span>
            <p class="text-sm font-medium text-base-content m-0">You're all caught up</p>
            <p class="text-xs text-base-content/50 m-0">No focus tasks or review requests need you right now.</p>
          {/if}
        </div>
      {:else}
        {#each navGroups as ng (ng.group.id)}
          {@const collapsed = collapsedIds.has(ng.group.id)}
          <div class="py-1">
            <!-- Project header: collapse/expand target. ↑/↓ only land here while
                 collapsed (then it's the group's only row); expanded, it's skipped. -->
            <div
              role="button"
              tabindex="0"
              data-attn-row={ng.headerIndex}
              aria-expanded={!collapsed}
              class="flex items-center gap-2.5 px-2 py-2 rounded-lg cursor-pointer border border-transparent transition-colors
                {focusedIndex === ng.headerIndex ? 'bg-base-200 border-primary ring-1 ring-primary' : 'hover:bg-base-200/70'}"
              onclick={() => toggleGroup(ng.group.id)}
              onkeydown={(e) => rowKeydown(e, () => toggleGroup(ng.group.id))}
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
                  {#if ng.group.taskItems.length > 0}
                    <span class="badge badge-ghost badge-sm">
                      {ng.group.taskItems.length} {taskLane === 'set-aside' ? 'set aside' : 'focus'}
                    </span>
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
                      <!-- Agent icon (green) — an OpenForge agent/task that needs you.
                           Same icon + colour as the project sidebar. -->
                      <span class="w-4 grid place-items-center shrink-0 text-success" aria-hidden="true">
                        <Bot size={15} />
                      </span>
                      <div class="min-w-0 flex-1 flex flex-col gap-0.5">
                        <span class="text-sm text-base-content truncate">{it.row.item.title}</span>
                        <span class="text-[11px] text-base-content/45 truncate">
                          {TASK_STATE_COMPACT_LABELS[state] ?? state} · {it.row.item.reason}
                        </span>
                      </div>
                      <span class="text-base-content/30 shrink-0">›</span>
                    </div>
                  {/if}
                {/each}

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
                      <!-- Pull-request icon (red) — a review request.
                           Same icon + colour as the project sidebar. -->
                      <span class="w-4 grid place-items-center shrink-0 text-error" aria-hidden="true">
                        <GitPullRequest size={15} />
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
  </div>
</Modal>
