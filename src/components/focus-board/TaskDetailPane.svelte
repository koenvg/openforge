<script lang="ts">
  import type { Task, PullRequestInfo } from '../../lib/types'
  import TaskInfoPanel from '../task-detail/TaskInfoPanel.svelte'

  interface Props {
    task: Task | null
    allTasks?: Task[]
    pullRequests?: PullRequestInfo[]
    onOpenFullView?: () => void
  }

  let { task, allTasks = [], pullRequests = [] }: Props = $props()
</script>

{#if task === null}
  <div class="rounded-[20px] bg-base-100 border border-base-300/60 shadow-sm p-5 flex flex-col gap-4 overflow-y-auto h-full items-center justify-center">
    <p class="text-xs text-base-content/40">Select a task to see details</p>
  </div>
{:else}
  <div class="rounded-[20px] bg-base-100 border border-base-300/60 shadow-sm overflow-y-auto h-full">
    <TaskInfoPanel
      {task}
      workspacePath={null}
      allTasksOverride={allTasks}
      taskPrsOverride={pullRequests}
      allowCommentAddressing={true}
      surface="transparent"
    />
  </div>
{/if}
