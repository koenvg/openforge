<script lang="ts">
  import type { TaskDetail, TaskReference } from '../../lib/types'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Pencil from '@lucide/svelte/icons/pencil'
  import { getTaskTitle } from '../../lib/taskTitle'
  import { getBoardStatusPresentation } from '../../lib/taskStatePresentation'
  import { createTaskTitleRename } from '../../lib/useTaskTitleRename.svelte'
  import TaskInfoPanel from './TaskInfoPanel.svelte'

  interface Props {
    task: TaskDetail | null
    workspacePath?: string | null
    allTasks?: TaskDetail[]
    dependencyReferenceTasks?: TaskReference[]
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
  const titleRename = createTaskTitleRename(() => task as TaskDetail, () => onTaskUpdated?.())

  function focusAndSelect(node: HTMLInputElement) {
    node.focus()
    node.select()
  }

  let taskTitle = $derived(task === null ? '' : getTaskTitle(task))
  let statusPresentation = $derived(getBoardStatusPresentation(task?.status ?? null))
</script>

{#if task === null}
  <aside data-testid="task-inspector-panel" class="flex h-full flex-col items-center justify-center gap-3 overflow-y-auto border-l border-base-300 bg-base-100 p-6" aria-label="Task inspector">
    <p class="text-sm font-medium text-base-content/60">Select a task to see details</p>
    <p class="max-w-52 text-center text-xs text-base-content/45">Ticket, pull requests, prompt, and labels stay visible here.</p>
  </aside>
{:else}
  <aside data-testid="task-inspector-panel" class="task-inspector flex h-full flex-col overflow-y-auto border-l border-base-300 bg-base-100" aria-label="Task inspector for {task.id}">
    <!-- No "Task" label and no chevron: the panel can only ever hold a task, and a caret
         that never collapses anything is a lie. The id and the title carry the header. -->
    <header class="task-inspector-header shrink-0 border-b border-base-300 py-4">
      <div class="flex min-h-10 items-center justify-between gap-3">
        <!-- Same treatment the task card gives the id, so the same task reads the same
             on the board and in this panel. -->
        <div class="font-mono text-sm font-semibold text-primary">{task.id}</div>
        {#if onOpenFullView}
          <Button variant="outline" size="sm" class="shrink-0" type="button" onclick={onOpenFullView}>
            Open full view
            <ExternalLink size={14} aria-hidden="true" />
          </Button>
        {/if}
      </div>
      <div class="mt-2 flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          {#if titleRename.editing && allowRename}
            <input
              class="input input-bordered h-8 min-h-8 w-full text-sm font-semibold"
              aria-label="Task title"
              value={titleRename.draft}
              oninput={(e) => titleRename.draft = e.currentTarget.value}
              onkeydown={titleRename.handleKeydown}
              onblur={() => titleRename.finish(true)}
              use:focusAndSelect
            />
          {:else}
            <div class="flex items-start gap-1">
              <h2 class="m-0 line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-snug text-base-content" title={taskTitle}>{taskTitle}</h2>
              {#if allowRename}
                <IconButton label="Rename task" size="xs" type="button" onclick={() => titleRename.start()}>
                  <Pencil size={12} aria-hidden="true" />
                </IconButton>
              {/if}
            </div>
          {/if}
        </div>
        <Badge variant={statusPresentation.badgeVariant}>{statusPresentation.label}</Badge>
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
  /* One column contract for the whole panel. `--panel-inset` is where the section carets
     start; `--panel-icon-column` is CollapsibleSection's caret plus the gap after it
     (0.75 + 0.5), which is where the section icons and every section body start. The task
     header has no caret, so it pays that offset directly to land on the same column. */
  .task-inspector {
    --panel-inset: 1rem;
    --panel-icon-column: 1.25rem;
  }

  .task-inspector-header {
    padding-left: calc(var(--panel-inset) + var(--panel-icon-column));
    padding-right: var(--panel-inset);
  }

  .task-inspector :global([data-task-info-card]) {
    --section-inset: var(--panel-inset);
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
    padding: 0.875rem var(--section-inset);
  }

  .task-inspector :global([data-task-info-card] h3 button) {
    min-height: 3.5rem;
    padding-top: 0.875rem;
    padding-bottom: 0.875rem;
  }
</style>
