<script lang="ts">
  import type { Snippet } from 'svelte'
  import TaskInitialPrompt from '../../../src/components/task-detail/TaskInitialPrompt.svelte'
  import type { TaskDetail } from '../../../src/lib/types'

  let { children, task }: { children: Snippet; task: TaskDetail } = $props()
</script>

<div class="flex h-full min-h-0 flex-1 justify-end overflow-hidden">
  <aside aria-label="Task status for {task.id}" class="task-inspector flex h-full w-[360px] shrink-0 flex-col overflow-y-auto border-l border-base-300 bg-base-100">
    <div class="flex min-h-max flex-col gap-4 p-4">
      <TaskInitialPrompt {task} />
      {@render children()}
    </div>
  </aside>
</div>
