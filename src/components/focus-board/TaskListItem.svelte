<script lang="ts">
  import type { Task, AgentSession, PullRequestInfo } from '../../lib/types'
  import { getTaskLabels } from '../../lib/taskLabels'
  import TaskLabelPills from '../shared/tasks/TaskLabelPills.svelte'
  import type { TaskState } from '../../lib/taskState'
  import { getStateDrivingPr } from '../../lib/taskState'
  import { getTaskListItemPresentation, getTaskStateBadgeClass } from '../../lib/taskStatePresentation'
  import { timeAgoFromSeconds } from '../../lib/timeAgo'
  import { getTaskTitle } from '../../lib/taskTitle'
  import { createTaskTitleRename } from '../../lib/useTaskTitleRename.svelte'

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
  let title = $derived(truncate(getTaskTitle(task), 80))
  let badgeClass = $derived(getTaskStateBadgeClass(state))
  let presentation = $derived(getTaskListItemPresentation(state, reasonText, isMerging))
  let firstPr = $derived(getStateDrivingPr(pullRequests))
  let labels = $derived(getTaskLabels(task))
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
  class="{isSelected
    ? 'rounded-2xl bg-base-100 border border-base-300/70 shadow-sm p-4 gap-2.5'
    : 'rounded-2xl bg-base-100 border border-base-200 p-4 gap-2'} flex flex-col cursor-pointer w-full text-left"
  onclick={onSelect}
  oncontextmenu={onContextMenu}
  onkeydown={(e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }}
>
  <div class="flex items-center gap-1.5">
    <span class="font-mono text-xs font-semibold text-primary">{task.id}</span>
    <span class="badge badge-xs {badgeClass}">
      {#if isMerging}
        <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
      {/if}
      {presentation.stateLabel}
    </span>
    <span class="font-mono text-xs text-base-content/50 ml-auto">{timeAgoFromSeconds(task.updated_at)}</span>
  </div>

  <div class="flex items-start gap-1.5">
    {#if titleRename.editing}
      <input
        class="input input-xs input-bordered flex-1 min-w-0 {isSelected ? 'text-lg font-semibold' : 'text-sm font-medium'}"
        aria-label="Task title"
        value={titleRename.draft}
        oninput={(e) => titleRename.draft = e.currentTarget.value}
        onkeydown={(e) => { e.stopPropagation(); titleRename.handleKeydown(e) }}
        onblur={() => titleRename.finish(true)}
        onclick={(e) => e.stopPropagation()}
        use:focusAndSelect
      />
    {:else}
      <div class="flex-1 min-w-0 {isSelected ? 'text-lg font-semibold' : 'text-sm font-medium'} leading-snug text-base-content">
        {title}
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square shrink-0 text-base-content/40 hover:text-base-content"
        aria-label="Rename task"
        onclick={(e) => { e.stopPropagation(); titleRename.start() }}
      >✎</button>
    {/if}
  </div>

  {#if presentation.reasonText}
    <div class="text-xs text-base-content/60 truncate">{presentation.reasonText}</div>
  {/if}

  {#if dependencyHint}
    <div class="text-xs text-warning truncate">{dependencyHint}</div>
  {/if}

  {#if showLabels && labels.length > 0}
    <TaskLabelPills {labels} max={3} />
  {/if}

  {#if firstPr}
    <div class="flex gap-1">
      <span class="font-mono text-[10px] font-medium px-1.5 py-px rounded text-primary bg-primary/10 border border-primary/20">
        PR #{firstPr.id}
      </span>
    </div>
  {/if}
</div>

<style>
  /* One-shot "pop" on the card the user just returned from, so it's easy to spot. */
  @keyframes just-viewed-pop {
    from {
      transform: scale(1.06);
    }
    to {
      transform: scale(1);
    }
  }

  .just-viewed-pop {
    animation: just-viewed-pop 260ms cubic-bezier(0.16, 1, 0.3, 1) both;
    transform-origin: center;
    will-change: transform;
  }

  @media (prefers-reduced-motion: reduce) {
    .just-viewed-pop {
      animation: none;
    }
  }
</style>
