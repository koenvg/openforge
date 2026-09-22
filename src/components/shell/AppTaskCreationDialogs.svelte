<script lang="ts">
  import AddTaskDialog from '../AddTaskDialog.svelte'
  import { activeProjectId } from '../../lib/stores'
  import { pendingComposeRequest, settleTaskCompose } from '../../lib/taskCompose'
  import type { AppTaskCreationController } from '../../lib/appTaskCreationController.svelte'

  interface Props {
    controller: AppTaskCreationController
    projectPath: string | null
    projectName: string | null
  }

  let { controller, projectPath, projectName }: Props = $props()
</script>

{#if controller.dialog && $activeProjectId}
  <AddTaskDialog
    mode={controller.dialog.mode}
    task={controller.dialog.task}
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
      {projectPath}
      {projectName}
      promptSeed={request.request.initialPrompt}
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
