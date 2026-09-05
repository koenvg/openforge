<script lang="ts">
  import ProjectDashboardProviderHost from '../../../src/components/focus-board/ProjectDashboardProviderHost.svelte'
  import ToastHost from '../../../src/components/feedback/toasts/ToastHost.svelte'
  import { projects, activeProjectId, tasks, taskDetailsById, activeSessions, ticketPrs, taskAttentionRows, taskAttentionLoaded, isLoading } from '../../../src/lib/stores'
  import PageFrame from './PageFrame.svelte'

  let { onOpenTask = () => {}, onNewTask = () => {}, onRunAction = () => {} }: {
    onOpenTask?: (taskId: string, projectId?: string | null) => void
    onNewTask?: () => void
    onRunAction?: (data: { taskId: string; actionPrompt: string }) => void
  } = $props()
  let project = $derived($projects.find(project => project.id === $activeProjectId) ?? null)
</script>

<PageFrame>
  <ProjectDashboardProviderHost
    {project}
    tasks={$tasks}
    taskDetailsById={$taskDetailsById}
    activeSessions={$activeSessions}
    ticketPrs={$ticketPrs}
    attentionRows={$taskAttentionRows}
    attentionRowsLoaded={$taskAttentionLoaded}
    isLoading={$isLoading}
    {onOpenTask}
    {onNewTask}
    {onRunAction}
  />
  {#snippet overlays()}<ToastHost />{/snippet}
</PageFrame>
