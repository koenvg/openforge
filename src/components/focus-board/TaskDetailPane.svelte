<script lang="ts">
  import type { Task, PullRequestInfo } from '../../lib/types'
  import TaskInfoPanel from '../task-detail/TaskInfoPanel.svelte'

  interface Props {
    task: Task | null
    allTasks?: Task[]
    pullRequests?: PullRequestInfo[]
    onOpenFullView?: () => void
    onEditTask?: (taskId: string) => void
  }

  let { task, allTasks = [], pullRequests = [], onOpenFullView, onEditTask }: Props = $props()
</script>

{#if task === null}
  <div class="rounded-[20px] bg-base-100 border border-base-300/60 shadow-sm p-5 flex flex-col gap-4 overflow-y-auto h-full items-center justify-center">
    <p class="text-xs text-base-content/40">Select a task to see details</p>
  </div>
{:else}
  <div class="rounded-[20px] bg-base-100 border border-base-300/60 shadow-sm overflow-y-auto h-full flex flex-col">
    <div class="flex items-center justify-between gap-2 p-3 pb-0 shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        <span class="font-mono text-sm font-bold text-base-content shrink-0">{task.id}</span>
        <span class="badge badge-sm badge-outline capitalize shrink-0" aria-label="Task status">{task.status}</span>
      </div>
      {#if onOpenFullView}
        <button class="btn btn-ghost btn-xs" type="button" onclick={onOpenFullView}>Open full view</button>
      {/if}
    </div>


    <TaskInfoPanel
      {task}
      workspacePath={null}
      allTasksOverride={allTasks}
      taskPrsOverride={pullRequests}
      allowCommentAddressing={true}
      surface="transparent"
      onEditPrompt={onEditTask ? () => onEditTask?.(task.id) : undefined}
    />
  </div>
{/if}
