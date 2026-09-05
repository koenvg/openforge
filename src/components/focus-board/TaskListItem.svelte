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
  import { getTaskListItemPresentation } from '../../lib/taskStatePresentation'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
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
  let StatusIcon = $derived(statusIcon(state))
  let presentation = $derived(getTaskListItemPresentation(state, reasonText, isMerging))
  let firstPr = $derived(getStateDrivingPr(pullRequests))
  let labels = $derived(getTaskLabels(task))
  let labelNamesText = $derived(labels.map((label) => label.name).join(', '))
  let dependencyCount = $derived(task.dependsOn.length)
</script>

<Panel class="task-list-item-shell" padding="none">
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
    class="task-list-item relative flex cursor-pointer flex-col gap-4 overflow-hidden p-5 text-left {isSelected
      ? 'task-list-item--selected'
      : 'task-list-item--interactive'}"
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
        <span class="font-mono text-sm font-semibold text-[var(--of-accent)]">{task.id}</span>
        <Badge variant={presentation.badgeVariant} class="gap-1">
          {#if isMerging}
            <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
          {:else}
            <StatusIcon size={14} aria-hidden="true" />
          {/if}
          {presentation.stateLabel}
        </Badge>
      </div>
    </div>

    <div class="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-3 text-sm text-[var(--of-text-secondary)]">
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
      <span class="font-mono text-sm text-[var(--of-text-muted)]">{timeAgoFromSeconds(task.updatedAt)}</span>
    </div>
  </div>

  <div class="flex items-start gap-2">
    {#if titleRename.editing}
      <input
        class="task-title-input min-w-0 flex-1 text-base font-semibold"
        aria-label="Task title"
        value={titleRename.draft}
        oninput={(e) => titleRename.draft = e.currentTarget.value}
        onkeydown={(e) => { e.stopPropagation(); titleRename.handleKeydown(e) }}
        onblur={() => titleRename.finish(true)}
        onclick={(e) => e.stopPropagation()}
        use:focusAndSelect
      />
    {:else}
      <div class="min-w-0 flex-1 text-lg font-semibold leading-snug text-[var(--of-text)]">
        {title}
      </div>
      <IconButton
        type="button"
        size="sm"
        variant="ghost"
        class="task-item-action-control shrink-0"
        label="Rename task"
        onclick={(e) => { e.stopPropagation(); titleRename.start() }}
      ><Pencil class="task-item-action task-item-action--quiet" size={15} aria-hidden="true" /></IconButton>
      <IconButton
        type="button"
        size="sm"
        variant="ghost"
        class="task-item-action-control shrink-0"
        label="More actions for {task.id}"
        onclick={(e) => { e.stopPropagation(); onContextMenu(e) }}
      ><MoreHorizontal class="task-item-action task-item-action--muted" size={16} aria-hidden="true" /></IconButton>
    {/if}
  </div>
  {#if showLabels && labels.length > 0}
    <TaskLabelPills labels={labels} max={3} />
  {/if}

  {#if firstPr}
    <div class="flex gap-1">
      <Badge variant="info" class="font-mono">
        PR #{firstPr.id}
      </Badge>
    </div>
  {/if}

  <div class="-mx-5 -mb-5 flex min-h-[var(--of-control-height-touch)] items-center gap-3 border-t border-[var(--of-border)] px-5 py-3.5 text-sm text-[var(--of-text-secondary)]">
    <span class="min-w-0 flex-1 truncate">
      {#if presentation.reasonText}
        {presentation.reasonText}
      {:else}
        {presentation.stateLabel}
      {/if}
    </span>

    {#if hasUnreadAgentOutput}
      <span
        class="inline-flex shrink-0 items-center gap-1 rounded-[var(--of-radius-round)] border border-info/25 bg-info/10 px-2 py-1 font-medium text-info"
        aria-label="Unread agent output"
      >
        <CircleDot size={13} aria-hidden="true" />
        <span>Unread agent output</span>
      </span>
    {/if}

    {#if dependencyHint}
      <Badge variant="warning" class="shrink-0 gap-1">
        <TriangleAlert size={13} aria-hidden="true" />
        {dependencyHint}
      </Badge>
    {/if}

  </div>
  </div>
</Panel>

<style>
  .task-list-item {
    isolation: isolate;
    border-radius: var(--of-radius-container);
    color: var(--of-text);
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      color var(--of-duration-fast) var(--of-ease-standard);
  }

  .task-list-item--interactive:hover {
    background: var(--of-control-hover);
  }

  .task-list-item:focus-visible {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  .task-title-input {
    box-sizing: border-box;
    min-height: var(--of-control-height-compact);
    padding-inline: var(--of-space2);
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-control);
    background: var(--of-field);
    color: var(--of-text);
    font-family: var(--of-font-sans);
  }

  .task-title-input:focus-visible {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  .task-list-item-selection-layer {
    position: absolute;
    inset: 0;
    z-index: -1;
    border: var(--of-border-width) solid var(--of-accent);
    border-radius: inherit;
    box-shadow: inset 0 0 0 var(--of-border-width) color-mix(in srgb, var(--of-accent) 20%, transparent);
    pointer-events: none;
    opacity: 0;
    transition: opacity 200ms ease;
    will-change: opacity;
  }

  .task-list-item--selected .task-list-item-selection-layer {
    opacity: 1;
  }

  :global(.task-item-action) {
    transition-property: opacity, transform;
    transition-duration: var(--of-duration-standard);
    will-change: opacity;
  }

  :global(.task-item-action--quiet) {
    opacity: 0.4;
  }

  :global(.task-item-action--muted) {
    opacity: 0.45;
  }

  :global(.task-item-action-control:is(:hover, :focus-visible) .task-item-action) {
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
