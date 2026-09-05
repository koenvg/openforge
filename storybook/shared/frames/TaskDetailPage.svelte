<script lang="ts">
  import TaskDetailView from '../../../src/components/task-detail/TaskDetailView.svelte'
  import type { TaskDetail } from '../../../src/lib/types'
  import type { TaskDetailHostLifecycleState } from '../../../src/components/task-detail/taskDetailHostLifecycle'
  import PageFrame from './PageFrame.svelte'

  let { task, hostLifecycle, onRunAction, onOpenTask }: {
    task: TaskDetail
    hostLifecycle: TaskDetailHostLifecycleState
    onRunAction: (data: { taskId: string; actionPrompt: string }) => void
    onOpenTask: (taskId: string, projectId?: string | null) => void
  } = $props()
</script>

<PageFrame>
  <TaskDetailView {task} {hostLifecycle} {onRunAction} {onOpenTask} />
</PageFrame>
