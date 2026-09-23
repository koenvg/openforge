<script lang="ts">
  import TaskDetailProviderHost from '../../../src/components/task-detail/TaskDetailProviderHost.svelte'
  import type { Project, TaskDetail } from '../../../src/lib/types'
  import PageFrame from './PageFrame.svelte'

  let { project, task, onRunAction }: {
    project: Project
    task: TaskDetail
    onRunAction: (data: { taskId: string; actionPrompt: string }) => void
  } = $props()
</script>

<PageFrame>
  <TaskDetailProviderHost {project} {task} {onRunAction} />
</PageFrame>
