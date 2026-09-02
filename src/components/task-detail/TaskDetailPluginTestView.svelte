<script lang="ts">
  import type { PluginTaskDetailReplacementProps } from '@openforge-app/plugin-sdk/frontend'

  let {
    api,
    context,
    project,
    task,
    relatedTasks,
    onOpenTask,
    onEditTask,
    onOpenTaskActions,
    onRefreshTask,
  }: PluginTaskDetailReplacementProps = $props()
</script>

<div data-testid="plugin-task-detail">
  {project.name}:{task.id}:{relatedTasks.map((related) => related.id).join(',')}:{context.pluginId}:{context.projectId}:{context.taskId}:{api ? 'api' : 'missing-api'}
</div>
<button onclick={() => onOpenTask('task-2', project.id)}>Open task</button>
<button onclick={onEditTask}>Edit task</button>
<button onclick={onOpenTaskActions}>Task actions</button>
<button onclick={() => void onRefreshTask()}>Refresh task</button>
