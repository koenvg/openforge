<script lang="ts">
  import type { Task } from '../../lib/types'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import TaskInfoPanel from './TaskInfoPanel.svelte'

  interface Props {
    task: Task | null
    workspacePath?: string | null
    allTasks?: Task[]
    dependencyReferenceTasks?: Task[]
    onOpenFullView?: () => void
    onOpenLinkedTask?: (taskId: string) => void
    onEditTask?: (taskId: string) => void
  }

  let { task, workspacePath = null, allTasks, dependencyReferenceTasks, onOpenFullView, onOpenLinkedTask, onEditTask }: Props = $props()
</script>

{#if task === null}
  <aside data-testid="task-inspector-panel" class="flex h-full flex-col items-center justify-center gap-3 overflow-y-auto border-l border-base-300 bg-base-100 p-6" aria-label="Task inspector">
    <p class="text-sm font-medium text-base-content/60">Select a task to see details</p>
    <p class="max-w-52 text-center text-xs text-base-content/45">Ticket, pull requests, handoff notes, prompt, and labels stay visible here.</p>
  </aside>
{:else}
  <aside data-testid="task-inspector-panel" class="task-inspector flex h-full flex-col overflow-y-auto border-l border-base-300 bg-base-100" aria-label="Task inspector for {task.id}">
    <header class="flex shrink-0 items-center justify-between gap-4 border-b border-base-300 px-6 py-5">
      <div class="min-w-0">
        <h2 class="truncate text-lg font-semibold tracking-[-0.01em] text-base-content">{task.id}</h2>
      </div>
      {#if onOpenFullView}
        <button class="btn btn-outline btn-sm shrink-0" type="button" onclick={onOpenFullView}>
          Open full view
          <ExternalLink size={14} aria-hidden="true" />
        </button>
      {/if}
    </header>

    <TaskInfoPanel
      {task}
      {workspacePath}
      allTasksOverride={allTasks}
      dependencyReferenceTasksOverride={dependencyReferenceTasks}
      surface="transparent"
      density="inspector"
      onEditPrompt={onEditTask ? () => onEditTask?.(task.id) : undefined}
      onOpenDependentTask={onOpenLinkedTask}
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

  .task-inspector :global([data-task-info-card="source-ticket"]) {
    min-height: 3.5rem;
    justify-content: center;
    padding: 0.875rem 1.5rem;
  }

  .task-inspector :global([data-task-info-card] h3 button) {
    min-height: 3.5rem;
    padding: 0.875rem 1.5rem;
  }
</style>
