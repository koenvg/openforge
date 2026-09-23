<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import type { TaskDetail } from '../../lib/types'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    taskId?: string
    task?: TaskDetail | null
    projectId?: string | null
  }

  let { api, context, taskId = '', task = null, projectId = null }: Props = $props()
</script>

<div data-testid="plugin-runtime-props">
  {context.pluginId}:{context.projectId}:{context.taskId}:{taskId}:{projectId}:{api ? 'api' : 'missing'}
  {#if task}<span data-testid="plugin-task-prompt">{task.prompt}</span>{/if}
</div>
