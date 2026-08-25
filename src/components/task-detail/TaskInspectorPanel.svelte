<script lang="ts">
  import type { Task } from '../../lib/types'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Pencil from '@lucide/svelte/icons/pencil'
  import { getTaskTitle } from '../../lib/taskTitle'
  import { createTaskTitleRename } from '../../lib/useTaskTitleRename.svelte'
  import TaskInfoPanel from './TaskInfoPanel.svelte'

  interface Props {
    task: Task | null
    workspacePath?: string | null
    allTasks?: Task[]
    dependencyReferenceTasks?: Task[]
    onOpenFullView?: () => void
    onOpenLinkedTask?: (taskId: string, projectId: string | null) => void
    onEditTask?: (taskId: string) => void
    onTaskUpdated?: () => void
    /**
     * Set to false where the surrounding screen already shows the title with its own
     * rename control (the task detail top bar), so the same task does not end up with
     * two identical pencils on screen.
     */
    allowRename?: boolean
  }

  let { task, workspacePath = null, allTasks, dependencyReferenceTasks, onOpenFullView, onOpenLinkedTask, onEditTask, onTaskUpdated, allowRename = true }: Props = $props()

  // Most tasks have no explicit title, so the header shows the first line of the prompt
  // and repeats what the Initial Prompt section says. Renaming here is the way out.
  const titleRename = createTaskTitleRename(() => task as Task, () => onTaskUpdated?.())

  function focusAndSelect(node: HTMLInputElement) {
    node.focus()
    node.select()
  }

  let taskTitle = $derived(task === null ? '' : getTaskTitle(task))
  let statusLabel = $derived(task?.status === 'doing' ? 'In Progress' : task?.status === 'done' ? 'Done' : 'Backlog')
  let statusClass = $derived(task?.status === 'doing'
    ? 'border-primary/35 bg-primary/10 text-primary'
    : task?.status === 'done'
      ? 'border-success/35 bg-success/10 text-success'
      : 'border-base-300 bg-base-200 text-base-content/65')
</script>

{#if task === null}
  <aside data-testid="task-inspector-panel" class="flex h-full flex-col items-center justify-center gap-3 overflow-y-auto border-l border-base-300 bg-base-100 p-6" aria-label="Task inspector">
    <p class="text-sm font-medium text-base-content/60">Select a task to see details</p>
    <p class="max-w-52 text-center text-xs text-base-content/45">Ticket, pull requests, prompt, and labels stay visible here.</p>
  </aside>
{:else}
  <aside data-testid="task-inspector-panel" class="task-inspector flex h-full flex-col overflow-y-auto border-l border-base-300 bg-base-100" aria-label="Task inspector for {task.id}">
    <header class="shrink-0 border-b border-base-300 px-4 py-4">
      <div class="flex min-h-10 items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <ChevronDown size={14} class="text-base-content/45" aria-hidden="true" />
          <h2 class="m-0 text-sm font-semibold text-base-content">Task</h2>
        </div>
        {#if onOpenFullView}
          <button class="btn btn-outline btn-sm min-h-10 shrink-0" type="button" onclick={onOpenFullView}>
            Open full view
            <ExternalLink size={14} aria-hidden="true" />
          </button>
        {/if}
      </div>
      <div class="mt-3 flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="font-mono text-xs font-semibold text-base-content/65">{task.id}</div>
          {#if titleRename.editing && allowRename}
            <input
              class="input input-bordered mt-1 h-8 min-h-8 w-full text-[13px] font-medium"
              aria-label="Task title"
              value={titleRename.draft}
              oninput={(e) => titleRename.draft = e.currentTarget.value}
              onkeydown={titleRename.handleKeydown}
              onblur={() => titleRename.finish(true)}
              use:focusAndSelect
            />
          {:else}
            <div class="mt-1 flex items-start gap-1">
              <p class="m-0 line-clamp-2 min-w-0 flex-1 text-[13px] font-medium leading-snug text-base-content" title={taskTitle}>{taskTitle}</p>
              {#if allowRename}
                <button
                  class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-base-content/40 transition-colors hover:bg-base-200 hover:text-base-content"
                  type="button"
                  aria-label="Rename task"
                  onclick={() => titleRename.start()}
                ><Pencil size={12} aria-hidden="true" /></button>
              {/if}
            </div>
          {/if}
        </div>
        <span class="shrink-0 rounded-md border px-2 py-1 text-xs font-semibold {statusClass}">{statusLabel}</span>
      </div>
    </header>

    <TaskInfoPanel
      {task}
      {workspacePath}
      allTasksOverride={allTasks}
      dependencyReferenceTasksOverride={dependencyReferenceTasks}
      surface="transparent"
      density="inspector"
      onEditPrompt={onEditTask ? () => onEditTask?.(task.id) : undefined}
      onOpenRelatedTask={onOpenLinkedTask}
    />
  </aside>
{/if}

<style>
  .task-inspector :global([data-task-info-card]) {
    border-width: 0 0 1px;
    border-color: var(--color-base-300);
    border-radius: 0;
    background: var(--color-base-100);
    box-shadow: none;
  }

  /* Single-row cards (the source ticket chip, the empty pull request row) share the
     header rows' height and padding so their icons and labels line up down the panel. */
  .task-inspector :global([data-card-layout="row"]) {
    min-height: 3.5rem;
    justify-content: center;
    padding: 0.875rem 1.5rem;
  }

  .task-inspector :global([data-task-info-card] h3 button) {
    min-height: 3.5rem;
    padding: 0.875rem 1.5rem;
  }
</style>
