<script lang="ts">
  import type { TaskDetail } from '../../lib/types'
  import type { TaskRunAppRegistration } from './taskRunAppController'
  import TaskDetailView from './TaskDetailView.svelte'

  interface Props {
    task: TaskDetail
    onRunAction: (data: { taskId: string; actionPrompt: string }) => void
    onEdit?: (taskId: string) => void
    onOpenTask?: (taskId: string, projectId?: string | null) => void | Promise<void>
    onTaskUpdated?: () => void | Promise<void>
    onProjectAttentionChanged?: () => void | Promise<void>
    onRunAppRegistrationChange?: (registration: TaskRunAppRegistration | null) => void
  }

  let {
    task,
    onRunAction,
    onEdit,
    onOpenTask,
    onTaskUpdated,
    onProjectAttentionChanged,
    onRunAppRegistrationChange,
  }: Props = $props()

</script>

<TaskDetailView
  {task}
  {onRunAction}
  {onEdit}
  {onOpenTask}
  {onTaskUpdated}
  {onProjectAttentionChanged}
  {onRunAppRegistrationChange}
/>
