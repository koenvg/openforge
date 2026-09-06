<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Bot, CircleDot, GitPullRequest } from '@lucide/svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import PluginSlot from '../plugin/PluginSlot.svelte'
  import { createAttentionOverviewInteraction } from '../../lib/attentionOverviewInteraction'
  import { attentionOverviewSource } from '../../lib/attentionOverviewSource'
  import type { AttentionTaskReference } from '../../lib/attentionOverview'
  import type { BoardFilter } from '../../lib/boardFilters'
  import type { ReviewPullRequest } from '../../lib/types'
  import { TASK_STATE_COMPACT_LABELS } from '../../lib/taskStatePresentation'

  interface Props {
    onClose: () => void
    onOpenTask: (task: AttentionTaskReference) => void
    onOpenPr: (pr: ReviewPullRequest, projectId: string | null) => void
  }

  let { onClose, onOpenTask, onOpenPr }: Props = $props()

  const CHIP_ACTIVE = 'border-primary/40 bg-primary/10 text-primary'
  const CHIP_NEUTRAL = 'border-base-300 bg-base-200/60 text-base-content/70 hover:text-base-content'
  const CHIP_MUTED = 'border-base-300 bg-base-200/40 text-base-content/40 hover:text-base-content/70'
  // How long a task may fly before its age is called out. Nothing enforces this; it only
  // tints the number so a long-running agent stands out from a fresh one.
  const STUCK_IN_FLIGHT_SECONDS = 4 * 3600

  const EMPTY_LANE_COPY: Record<BoardFilter, { title: string; hint: string }> = {
    focus: {
      title: "You're all caught up",
      hint: 'No focus tasks or review requests need you right now.',
    },
    'in-flight': {
      title: 'Nothing is in flight',
      hint: 'No project has a task running or waiting on CI.',
    },
    'out-of-focus': {
      title: 'Nothing is set aside',
      hint: 'No project has a task parked in Out of Focus.',
    },
    backlog: {
      title: 'The backlog is empty',
      hint: 'Every task in every project has been started.',
    },
  }

  const interaction = createAttentionOverviewInteraction(attentionOverviewSource, (intent) => {
    if (intent.kind === 'task') onOpenTask(intent.task)
    else onOpenPr(intent.pr, intent.projectId)
  })
  onMount(() => { void interaction.start() })
  onDestroy(() => interaction.dispose())

  let bodyEl = $state<HTMLElement | null>(null)
  let loading = $derived($interaction.loading)
  let error = $derived($interaction.error)
  let retrying = $state(false)

  async function retry(): Promise<void> {
    if (retrying) return
    retrying = true
    try { await interaction.refresh() } finally { retrying = false }
  }

  let taskLane = $derived($interaction.taskLane)
  let laneLabel = $derived($interaction.laneLabel)
  let taskCount = $derived($interaction.taskCount)
  let reviewCount = $derived($interaction.reviewCount)
  let runningAgents = $derived($interaction.runningAgents)
  let showReviews = $derived($interaction.showReviews)
  let reviewsHidden = $derived($interaction.reviewsHidden)
  let collapsedIds = $derived($interaction.collapsedIds)
  let focusedIndex = $derived($interaction.focusedIndex)
  let rows = $derived($interaction.rows)
  let navGroups = $derived($interaction.navGroups)
  let runningAgentsLabel = $derived(
    runningAgents === 0
      ? 'No agents running'
      : `${runningAgents} agent${runningAgents === 1 ? '' : 's'} running`,
  )

  function onKeydown(event: KeyboardEvent): boolean | void {
    if (interaction.handleKey(event)) {
      event.preventDefault()
      return true
    }
  }

  function activate(index: number): void {
    interaction.dispatch({ kind: 'activate', index })
  }

  function focusRow(index: number): void {
    interaction.dispatch({ kind: 'focus', index })
  }

  function rowKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      activate(index)
    }
  }

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

  function elapsed(seconds: number): number {
    return Math.max(0, Date.now() / 1000 - seconds)
  }

  function relTime(seconds: number): string {
    if (!seconds) return ''
    const delta = elapsed(seconds)
    if (delta < 3600) return `${Math.max(1, Math.round(delta / 60))}m ago`
    if (delta < 86400) return `${Math.round(delta / 3600)}h ago`
    return `${Math.round(delta / 86400)}d ago`
  }

  /**
   * How long the task has been flying, read off its last recorded state change: for a running
   * agent that is the moment it started, and for a task waiting on CI the moment the agent
   * handed off. Nothing records lane transitions themselves, so this is the closest honest
   * answer to "how long has this been sitting here".
   */
  function inFlightAge(seconds: number): string {
    if (!seconds) return ''
    const delta = elapsed(seconds)
    if (delta < 60) return 'just now'
    if (delta < 3600) return `${Math.round(delta / 60)}m`
    if (delta < 86400) return `${Math.round(delta / 3600)}h`
    return `${Math.round(delta / 86400)}d`
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
        <!-- Always on screen, whatever T and R are set to. The focus lane deliberately holds
             no running agent, so without this the dialog can look idle while five agents
             work. -->
        <span class="text-[11px] leading-tight flex items-center gap-1.5 min-w-0">
          <span class="flex items-center gap-1 {runningAgents > 0 ? 'text-success' : 'text-base-content/50'}">
            {#if runningAgents > 0}
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-success animate-pulse" aria-hidden="true"></span>
            {/if}
            {error ? 'Agent status may be out of date' : runningAgentsLabel}
          </span>
          {#if taskLane !== 'focus'}
            <span class="text-base-content/40 truncate">· Showing the {laneLabel} lane</span>
          {/if}
        </span>
      </div>
      <div class="flex-1"></div>
      <!-- Two chips, mirroring the two keyboard shortcuts, so the letters are discoverable
           without a legend and the current state is always on screen. R shows or hides the
           reviews. T names the one board lane on screen and steps to the next one. -->
      <div class="flex items-center gap-1.5 shrink-0">
        {#each [
          {
            key: 'T',
            label: laneLabel,
            count: taskCount,
            // Not aria-pressed: this steps through four lanes rather than switching one
            // thing on and off, and its own label already says which lane is showing.
            pressed: undefined,
            // Focus is the default lane, so it reads normal rather than switched-off; only
            // a detour into another lane lights up.
            tone: taskLane === 'focus' ? CHIP_NEUTRAL : CHIP_ACTIVE,
            toggle: () => interaction.dispatch({ kind: 'cycle-lane' }),
          },
          {
            key: 'R',
            label: 'Reviews',
            count: reviewCount,
            pressed: showReviews,
            tone: showReviews ? CHIP_ACTIVE : CHIP_MUTED,
            toggle: () => interaction.dispatch({ kind: 'toggle-reviews' }),
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

    <div role="status">
      {#if $interaction.preferenceError}
        <p class="text-xs text-base-content/70 px-5 py-2 m-0 border-b border-base-300">
          Couldn't save preferences. Your choices still apply here, but may be lost when you reopen this dialog.
        </p>
      {/if}
    </div>

    <!-- Body -->
    <!-- tabindex lets the scroll container hold focus while the list is empty, so the
         dialog keeps receiving E and R instead of losing them to <body>. -->
    <div bind:this={bodyEl} tabindex="-1" class="overflow-y-auto flex-1 min-h-0 px-3 py-2 outline-none">
      {#if error}
        <div class="rounded-lg border border-error/30 bg-error/5 p-3 mb-2">
          <div role="alert">
            <p class="text-sm font-medium m-0">Couldn't load attention overview.</p>
            <p class="text-xs text-base-content/70 mt-1 mb-0 break-words">{error}</p>
            {#if navGroups.length > 0}
              <p class="text-xs text-base-content/70 mt-1 mb-0">Showing the last available results. They may be out of date.</p>
            {/if}
          </div>
          <button type="button" class="btn btn-sm btn-ghost mt-2" disabled={retrying} onclick={retry}>
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      {/if}
      {#if loading}
        <div class="flex flex-col items-center justify-center gap-3 py-16 text-base-content/50 text-sm">
          <span class="loading loading-spinner loading-md text-primary"></span>
          <span>Gathering what needs your attention…</span>
        </div>
      {:else if navGroups.length === 0 && !error}
        <div class="flex flex-col items-center justify-center gap-2 py-16 text-center">
          {#if reviewsHidden}
            <p class="text-sm font-medium text-base-content m-0">Reviews are hidden</p>
            <p class="text-xs text-base-content/50 m-0">Press R to bring them back.</p>
          {:else}
            {#if taskLane === 'focus'}
              <span class="text-2xl">🎉</span>
            {/if}
            <p class="text-sm font-medium text-base-content m-0">{EMPTY_LANE_COPY[taskLane].title}</p>
            <p class="text-xs text-base-content/50 m-0">
              {EMPTY_LANE_COPY[taskLane].hint}
              {#if taskLane !== 'focus'}Press T for the next lane.{/if}
            </p>
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
              onclick={() => activate(ng.headerIndex)}
              onkeydown={(e) => rowKeydown(e, ng.headerIndex)}
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
                      {ng.group.taskItems.length} {laneLabel.toLowerCase()}
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
                    {@const state = it.row.item.state}
                    <div
                      role="button"
                      tabindex="0"
                      data-attn-row={it.index}
                      class="flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer border border-transparent transition-colors
                        {focusedIndex === it.index ? 'bg-base-200 border-primary ring-1 ring-primary' : 'hover:bg-base-200/70'}"
                      onclick={() => activate(it.index)}
                      onkeydown={(e) => rowKeydown(e, it.index)}
                      onfocus={() => focusRow(it.index)}
                    >
                      <!-- Agent icon (green) — an OpenForge agent/task that needs you.
                           Same icon + colour as the project sidebar. -->
                      <span class="w-4 grid place-items-center shrink-0 text-success" aria-hidden="true">
                        <Bot size={15} />
                      </span>
                      <div class="min-w-0 flex-1 flex flex-col gap-0.5">
                        <span class="flex min-w-0 items-center gap-2">
                          <span class="min-w-0 flex-1 truncate text-sm text-base-content">{it.row.item.title}</span>
                          {#if it.row.item.hasUnreadAgentOutput}
                            <span
                              class="inline-flex shrink-0 items-center gap-1 rounded-full border border-info/25 bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info"
                              aria-label="Unread agent output"
                            >
                              <CircleDot size={11} aria-hidden="true" />
                              <span>Unread agent output</span>
                            </span>
                          {/if}
                        </span>
                        <span class="text-[11px] text-base-content/45 truncate">
                          {TASK_STATE_COMPACT_LABELS[state] ?? state} · {it.row.item.reason}
                        </span>
                      </div>
                      <!-- In Flight only: how long the task has been flying, in its own column
                           so the ages line up and a stuck one is obvious at a glance. The
                           reason line is truncated, so this cannot live inside it. -->
                      {#if taskLane === 'in-flight'}
                        {@const age = inFlightAge(it.row.item.activityAt)}
                        {#if age}
                          <span
                            class="text-[11px] tabular-nums shrink-0 {elapsed(it.row.item.activityAt) >= STUCK_IN_FLIGHT_SECONDS ? 'text-warning font-medium' : 'text-base-content/40'}"
                            title="In flight since the last state change ({relTime(it.row.item.activityAt)})"
                          >{age}</span>
                        {/if}
                      {/if}
                      <span class="text-base-content/30 shrink-0">›</span>
                    </div>
                  {/if}
                {/each}

                {#each ng.items.filter((it) => it.row.kind === 'review') as it (it.row.kind === 'review' ? it.row.pr.id : it.index)}
                  {#if it.row.kind === 'review'}
                    {@const pr = it.row.pr}
                    {@const prProjectId = ng.group.projectId}
                    <div
                      role="button"
                      tabindex="0"
                      data-attn-row={it.index}
                      class="flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer border border-transparent transition-colors
                        {focusedIndex === it.index ? 'bg-base-200 border-primary ring-1 ring-primary' : 'hover:bg-base-200/70'}"
                      onclick={() => activate(it.index)}
                      onkeydown={(e) => rowKeydown(e, it.index)}
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
                      <!-- Plugin-contributed row controls (GitHub Sync puts the walkthrough +
                           AI review button here). Activation is swallowed so pressing the
                           button does not also open the pull request behind it: the click for
                           the mouse, Enter/Space for a keyboard tabbed onto the button. The
                           navigation keys still bubble, so ↑/↓ and T keep working from here. -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div
                        class="shrink-0"
                        onclick={(e) => e.stopPropagation()}
                        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
                      >
                        <PluginSlot
                          slotType="reviewRowActions"
                          projectId={prProjectId}
                          extraProps={{ pr }}
                        />
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
