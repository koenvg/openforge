<script lang="ts">
  import type { PluginProjectDashboardReplacementProps } from '@openforge-app/plugin-sdk/frontend'

  let { api, context, project, onOpenTask, onComposeTask, onOpenCommandSearch }: PluginProjectDashboardReplacementProps = $props()
</script>

<div data-testid="plugin-project-dashboard">
  <span>{project.name}:{context.pluginId}:{context.projectId}:{api ? 'api' : 'missing'}</span>
  <button type="button" onclick={() => onOpenTask('task-1')}>Open task</button>
  <button type="button" onclick={onComposeTask}>New task</button>
  <button type="button" onclick={onOpenCommandSearch}>Search tasks</button>
</div>
