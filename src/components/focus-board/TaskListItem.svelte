<script lang="ts">
  import GitPullRequest from '@lucide/svelte/icons/git-pull-request'
  import Link from '@lucide/svelte/icons/link'
  import Pencil from '@lucide/svelte/icons/pencil'
  import Tags from '@lucide/svelte/icons/tags'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import type { Task, AgentSession, PullRequestInfo } from '../../lib/types'
  import { getTaskLabels } from '../../lib/taskLabels'
  import type { TaskState } from '../../lib/taskState'
  import { getStateDrivingPr } from '../../lib/taskState'
  import { getTaskListItemPresentation, getTaskStateBadgeClass } from '../../lib/taskStatePresentation'
  import { timeAgoFromSeconds } from '../../lib/timeAgo'
  import { getTaskDisplayTitle } from '../../lib/taskTitle'
  import { createTaskTitleRename } from '../../lib/useTaskTitleRename.svelte'
  import TaskLabelPills from '../shared/tasks/TaskLabelPills.svelte'

  interface Props {
    task: Task
    state: TaskState
    session: AgentSession | null
    pullRequests: PullRequestInfo[]
    reasonText: string
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

  let { task, state, session, pullRequests, reasonText, dependencyHint = null, showLabels = false, isSelected, isFocused, justViewed = false, isMerging, onSelect, onContextMenu, onTaskUpdated }: Props = $props()

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

  let title = $derived(truncate(getTaskDisplayTitle(task), 80))
  let badgeClass = $derived(getTaskStateBadgeClass(state))
  let presentation = $derived(getTaskListItemPresentation(state, reasonText, isMerging))
  let firstPr = $derived(getStateDrivingPr(pullRequests))
  let labels = $derived(getTaskLabels(task))
  let labelNamesText = $derived(labels.map((label) => label.name).join(', '))
  let dependencyCount = $derived(task.depends_on.length)
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
  class="relative flex w-full cursor-pointer flex-col gap-3 overflow-hidden rounded-2xl border bg-base-100 p-4 text-left shadow-sm transition-[background-color,border-color,box-shadow] duration-200 {isSelected
    ? 'border-primary/30 bg-base-100 shadow-sm'
    : 'border-base-200 hover:border-base-300'}"
  onclick={onSelect}
  oncontextmenu={onContextMenu}
  onkeydown={(e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }}
>
  {#if isSelected}
    <span class="absolute inset-x-0 top-0 h-1.5 bg-primary/25" aria-hidden="true"></span>
  {/if}

  <div class="flex items-start gap-3 pt-0.5">

    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="font-mono text-xs font-semibold text-primary">{task.id}</span>
        <span class="badge badge-xs {badgeClass}">
          {#if isMerging}
            <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
          {/if}
          {presentation.stateLabel}
        </span>
      </div>
    </div>

    <div class="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-base-content/60">
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
      <span class="font-mono text-xs text-base-content/50">{timeAgoFromSeconds(task.updated_at)}</span>
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
      <div class="min-w-0 flex-1 text-base font-semibold leading-snug text-base-content">
        {title}
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square shrink-0 text-base-content/40 hover:text-base-content"
        aria-label="Rename task"
        onclick={(e) => { e.stopPropagation(); titleRename.start() }}
      ><Pencil size={15} aria-hidden="true" /></button>
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

  <div class="-mx-4 -mb-4 flex items-center gap-2 border-t border-base-200/80 bg-base-200/40 px-4 py-3 text-xs text-base-content/60">
    <span class="min-w-0 flex-1 truncate">
      {#if presentation.reasonText}
        {presentation.reasonText}
      {:else}
        {presentation.stateLabel}
      {/if}
    </span>

    {#if dependencyHint}
      <span class="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/25 bg-warning/10 px-2 py-1 font-medium text-warning">
        <TriangleAlert size={13} aria-hidden="true" />
        {dependencyHint}
      </span>
    {/if}

  </div>
</div>

<style>
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
