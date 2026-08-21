<script lang="ts">
  import { onMount } from 'svelte'
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import TaskSchedulesDialogs from './TaskSchedulesDialogs.svelte'
  import TaskSchedulesWorkspace from './TaskSchedulesWorkspace.svelte'
  import { useTaskSchedulesController } from './taskSchedulesController.svelte'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectId: string | null
    projectName?: string
  }

  let { api, context: _context, projectId }: Props = $props()
  const controller = useTaskSchedulesController({
    getApi: () => api,
    getProjectId: () => projectId,
  })

  onMount(() => {
    const refresh = () => controller.refreshSchedules()
    window.addEventListener('focus', refresh)
    const interval = window.setInterval(refresh, 30_000)
    return () => {
      window.removeEventListener('focus', refresh)
      window.clearInterval(interval)
    }
  })
</script>

<TaskSchedulesWorkspace {controller} />
<TaskSchedulesDialogs {controller} />
