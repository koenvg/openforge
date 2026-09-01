<script lang="ts">
  import type { AgentSession, PullRequestInfo, TaskAttentionRow, TaskDetail, TaskReference } from '../../lib/types'
  import FocusBoard from './FocusBoard.svelte'

  interface Props {
    projectId: string | null
    projectName: string
    tasks: TaskDetail[]
    taskDetailsById?: Map<string, TaskDetail>
    dependencyReferenceTasks?: TaskReference[]
    activeSessions: Map<string, AgentSession>
    ticketPrs: Map<string, PullRequestInfo[]>
    attentionRows?: TaskAttentionRow[]
    attentionRowsLoaded?: boolean
    isLoading: boolean
    onOpenTask: (taskId: string, projectId?: string | null) => void | Promise<void>
    onEditTask?: (taskId: string) => void
    onTaskUpdated?: () => void | Promise<void>
    onProjectAttentionChanged?: () => void | Promise<void>
    onNewTask?: () => void
    onOpenCommandSearch?: () => void
    onRunAction: (data: { taskId: string; actionPrompt: string; promptPrefix?: string | null }) => void
  }

  let {
    projectId,
    projectName,
    tasks,
    taskDetailsById = new Map(),
    dependencyReferenceTasks = [],
    activeSessions,
    ticketPrs,
    attentionRows = [],
    attentionRowsLoaded = true,
    isLoading,
    onOpenTask,
    onEditTask,
    onTaskUpdated,
    onProjectAttentionChanged,
    onNewTask,
    onOpenCommandSearch,
    onRunAction,
  }: Props = $props()

</script>

<div class="flex-1 overflow-hidden">
  {#if isLoading && tasks.length === 0}
    <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm">
      <span class="loading loading-spinner loading-md text-primary"></span>
      <span>Loading tasks...</span>
    </div>
  {:else}
    <FocusBoard
      {projectId}
      {projectName}
      {tasks}
      {taskDetailsById}
      {dependencyReferenceTasks}
      {activeSessions}
      {ticketPrs}
      {attentionRows}
      {attentionRowsLoaded}
      {onOpenTask}
      {onEditTask}
      {onTaskUpdated}
      {onProjectAttentionChanged}
      {onOpenCommandSearch}
      {onNewTask}
      {onRunAction}
    />
  {/if}
</div>
