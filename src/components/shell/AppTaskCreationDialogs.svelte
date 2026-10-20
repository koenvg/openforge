<script lang="ts">
  import AddTaskDialog from '../AddTaskDialog.svelte'
  import { activeProjectId } from '../../lib/stores'
  import { pendingComposeRequest, settleTaskCompose } from '../../lib/taskCompose'
  import type { AppTaskCreationController } from '../../lib/appTaskCreationController.svelte'
  import type { Project } from '../../lib/types'

  interface Props {
    controller: AppTaskCreationController
    projects?: readonly Pick<Project, 'id' | 'name' | 'path'>[]
    projectPath: string | null
    projectName: string | null
  }

  let { controller, projects = [], projectPath, projectName }: Props = $props()

  // New Task opens from anywhere, so it falls back to the first project when none is active.
  const newTaskProjectId = $derived($activeProjectId ?? projects[0]?.id ?? null)
</script>

{#if controller.dialog && newTaskProjectId}
  <AddTaskDialog
    mode={controller.dialog.mode}
    task={controller.dialog.task}
    {projects}
    initialProjectId={newTaskProjectId}
    {projectPath}
    {projectName}
    onClose={controller.closeTaskDialog}
    onTaskSaved={controller.taskSaved}
    onTaskCreated={controller.taskCreated}
  />
{/if}

{#if $pendingComposeRequest}
  {@const request = $pendingComposeRequest}
  {#key request}
    <AddTaskDialog
      mode="create"
      {projects}
      initialProjectId={request.request.projectId}
      {projectPath}
      {projectName}
      promptSeed={request.request.initialPrompt}
      sourceTicketUrlSeed={request.request.sourceTicketUrl ?? null}
      titleSeed={request.request.title ?? null}
      worktreeSourceSeed={request.request.worktreeSource ?? null}
      worktreeBranchSeed={request.request.worktreeBranch ?? null}
      onClose={() => {
        if ($pendingComposeRequest === request) settleTaskCompose(null)
      }}
      onTaskCreated={(task, intent) => {
        if ($pendingComposeRequest === request) settleTaskCompose({ task, started: intent === 'start' })
        controller.taskCreated(task, intent)
      }}
    />
  {/key}
{/if}
