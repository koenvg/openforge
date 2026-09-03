<script lang="ts">
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import CircleCheck from '@lucide/svelte/icons/circle-check'
  import CircleDot from '@lucide/svelte/icons/circle-dot'
  import Layers3 from '@lucide/svelte/icons/layers-3'
  import MoreHorizontal from '@lucide/svelte/icons/more-horizontal'
  import GitPullRequest from '@lucide/svelte/icons/git-pull-request'
  import Link from '@lucide/svelte/icons/link'
  import Pencil from '@lucide/svelte/icons/pencil'
  import Tags from '@lucide/svelte/icons/tags'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import type { TaskDetail, AgentSession, PullRequestInfo } from '../../lib/types'
  import { getTaskLabels } from '../../lib/taskLabels'
  import type { TaskState } from '../../lib/taskState'
  import { getStateDrivingPr } from '../../lib/taskState'
  import { getTaskListItemPresentation, getTaskStateBadgeClass } from '../../lib/taskStatePresentation'
  import { timeAgoFromSeconds } from '../../lib/timeAgo'
  import { getTaskTitle } from '../../lib/taskTitle'
  import { createTaskTitleRename } from '../../lib/useTaskTitleRename.svelte'
  import TaskLabelPills from '../shared/tasks/TaskLabelPills.svelte'

  interface Props {
    task: TaskDetail
    state: TaskState
    session: AgentSession | null
    pullRequests: PullRequestInfo[]
    reasonText: string
    hasUnreadAgentOutput?: boolean
    dependencyHint?: string | null
    showLabels?: boolean
    isSelected: boolean
    isFocused: boolean
    justViewed?: boolean
    isMerging: boolean
    onSelect: () => void
    onContextMenu: (e: MouseEvent) => void
    onTaskUpdated?: () => void | Promise<void>
  }

  let {
    task,
    state,
    session,
    pullRequests,
    reasonText,
    hasUnreadAgentOutput = false,
    dependencyHint = null,
    showLabels = false,
    isSelected,
    isFocused,
    justViewed = false,
    isMerging,
    onSelect,
    onContextMenu,
    onTaskUpdated,
  }: Props = $props()

  const titleRename = createTaskTitleRename(() => task, () => onTaskUpdated?.())

  function focusAndSelect(node: HTMLInputElement) {
    node.focus()
    node.select()
  }

  function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + '...' : text
  }

  function pluralize(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
  }

  function statusIcon(taskState: TaskState) {
    if (taskState === 'done' || taskState === 'agent-done' || taskState === 'pr-merged') return CircleCheck
    if (['failed', 'interrupted', 'ci-failed', 'changes-requested', 'merge-conflict'].includes(taskState)) return CircleAlert
    if (taskState === 'backlog') return Layers3
    return CircleDot
  }

  let title = $derived(truncate(getTaskTitle(task), 80))
  let badgeClass = $derived(getTaskStateBadgeClass(state))
  let StatusIcon = $derived(statusIcon(state))
  let presentation = $derived(getTaskListItemPresentation(state, reasonText, isMerging))
  let firstPr = $derived(getStateDrivingPr(pullRequests))
  let labels = $derived(getTaskLabels(task))
  let labelNamesText = $derived(labels.map((label) => label.name).join(', '))
  let dependencyCount = $derived(task.dependsOn.length)
</script>

<div
  role="button"
  tabindex="0"
  data-vim-item
  data-selected={isSelected ? 'true' : undefined}
  data-focused={isFocused ? 'true' : undefined}
  data-just-viewed={justViewed ? 'true' : undefined}
  aria-current={isFocused ? 'true' : undefined}
  class:vim-focus={isFocused}
  class:just-viewed-pop={justViewed}
  class="task-list-item relative flex w-full cursor-pointer flex-col gap-4 overflow-hidden rounded-xl border border-base-300 bg-base-100 p-5 text-left {isSelected
    ? 'task-list-item--selected'
    : 'composited-hover-layer task-list-item--interactive'}"
  onclick={onSelect}
  oncontextmenu={onContextMenu}
  onkeydown={(e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }}
>
  <span class="task-list-item-selection-layer" aria-hidden="true"></span>

  <div class="flex items-start gap-3 pt-0.5">

    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="font-mono text-sm font-semibold text-primary">{task.id}</span>
        <span class="badge badge-sm gap-1 {badgeClass}">
          {#if isMerging}
            <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
          {:else}
            <StatusIcon size={14} aria-hidden="true" />
          {/if}
          {presentation.stateLabel}
        </span>
      </div>
    </div>

    <div class="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-3 text-sm text-base-content/55">
      {#if dependencyCount > 0}
        <span class="inline-flex items-center gap-1" aria-label={pluralize(dependencyCount, 'dependency', 'dependencies')}>
          <Link size={14} aria-hidden="true" />
          <span>{pluralize(dependencyCount, 'dep')}</span>
        </span>
      {/if}
      {#if showLabels && labels.length > 0}
        <span class="inline-flex items-center gap-1" aria-label={`Labels: ${labelNamesText}`}>
          <Tags size={14} aria-hidden="true" />
          <span>{pluralize(labels.length, 'label')}</span>
        </span>
      {/if}
      {#if pullRequests.length > 0}
        <span class="inline-flex items-center gap-1" aria-label={pluralize(pullRequests.length, 'pull request')}>
          <GitPullRequest size={14} aria-hidden="true" />
          <span>{pluralize(pullRequests.length, 'PR')}</span>
        </span>
      {/if}
      <span class="font-mono text-sm text-base-content/50">{timeAgoFromSeconds(task.updatedAt)}</span>
    </div>
  </div>

  <div class="flex items-start gap-2">
    {#if titleRename.editing}
      <input
        class="input input-xs input-bordered min-w-0 flex-1 text-base font-semibold"
        aria-label="Task title"
        value={titleRename.draft}
        oninput={(e) => titleRename.draft = e.currentTarget.value}
        onkeydown={(e) => { e.stopPropagation(); titleRename.handleKeydown(e) }}
        onblur={() => titleRename.finish(true)}
        onclick={(e) => e.stopPropagation()}
        use:focusAndSelect
      />
    {:else}
      <div class="min-w-0 flex-1 text-lg font-semibold leading-snug text-base-content">
        {title}
      </div>
      <button
        type="button"
        class="task-item-action-control btn btn-ghost btn-sm btn-square shrink-0 text-base-content"
        aria-label="Rename task"
        onclick={(e) => { e.stopPropagation(); titleRename.start() }}
      ><Pencil class="task-item-action task-item-action--quiet" size={15} aria-hidden="true" /></button>
      <button
        type="button"
        class="task-item-action-control btn btn-ghost btn-sm btn-square shrink-0 text-base-content"
        aria-label="More actions for {task.id}"
        onclick={(e) => { e.stopPropagation(); onContextMenu(e) }}
      ><MoreHorizontal class="task-item-action task-item-action--muted" size={16} aria-hidden="true" /></button>
    {/if}
  </div>
  {#if showLabels && labels.length > 0}
    <TaskLabelPills labels={labels} max={3} />
  {/if}

  {#if firstPr}
    <div class="flex gap-1">
      <span class="rounded border border-primary/20 bg-primary/10 px-1.5 py-px font-mono text-[10px] font-medium text-primary">
        PR #{firstPr.id}
      </span>
    </div>
  {/if}

  <div class="-mx-5 -mb-5 flex min-h-12 items-center gap-3 border-t border-base-300 px-5 py-3.5 text-sm text-base-content/60">
    <span class="min-w-0 flex-1 truncate">
      {#if presentation.reasonText}
        {presentation.reasonText}
      {:else}
        {presentation.stateLabel}
      {/if}
    </span>

    {#if hasUnreadAgentOutput}
      <span
        class="inline-flex shrink-0 items-center gap-1 rounded-full border border-info/25 bg-info/10 px-2 py-1 font-medium text-info"
        aria-label="Unread agent output"
      >
        <CircleDot size={13} aria-hidden="true" />
        <span>Unread agent output</span>
      </span>
    {/if}

    {#if dependencyHint}
      <span class="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/25 bg-warning/10 px-2 py-1 font-medium text-warning">
        <TriangleAlert size={13} aria-hidden="true" />
        {dependencyHint}
      </span>
    {/if}

  </div>
</div>

<style>
  .task-list-item {
    isolation: isolate;
  }

  .task-list-item--interactive {
    --composited-hover-background: color-mix(in oklch, var(--color-base-200) 30%, transparent);
    --composited-hover-border: 1px solid color-mix(in oklch, var(--color-base-content) 25%, transparent);
  }

  .task-list-item-selection-layer {
    position: absolute;
    inset: 0;
    z-index: -1;
    border: 1px solid var(--color-accent);
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-accent) 20%, transparent);
    pointer-events: none;
    opacity: 0;
    transition: opacity 200ms ease;
    will-change: opacity;
  }

  .task-list-item--selected .task-list-item-selection-layer {
    opacity: 1;
  }

  .task-item-action {
    transition-property: opacity, transform;
    transition-duration: 200ms;
    will-change: opacity;
  }

  .task-item-action--quiet {
    opacity: 0.4;
  }

  .task-item-action--muted {
    opacity: 0.45;
  }

  .task-item-action-control:is(:hover, :focus-visible) :global(.task-item-action) {
    opacity: 1;
  }

  /* One-shot fade on the card the user just returned from, so it's easy to spot without changing size. */
  @keyframes just-viewed-pop {
    from {
      opacity: 0.72;
    }
    to {
      opacity: 1;
    }
  }

  .just-viewed-pop {
    animation: just-viewed-pop 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
    will-change: opacity;
  }

  @media (prefers-reduced-motion: reduce) {
    .just-viewed-pop {
      animation: none;
    }
  }
</style>
