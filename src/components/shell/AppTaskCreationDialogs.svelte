<script lang="ts">
  import AddTaskDialog from '../AddTaskDialog.svelte'
  import { activeProjectId } from '../../lib/stores'
  import { pendingComposeRequest } from '../../lib/taskCompose'
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
    onRunAction={controller.runTask}
  />
{/if}

{#if $pendingComposeRequest}
  <AddTaskDialog
    mode="create"
    {projectPath}
    promptSeed={$pendingComposeRequest.request.initialPrompt}
    sourceTicketUrlSeed={$pendingComposeRequest.request.sourceTicketUrl ?? null}
    titleSeed={$pendingComposeRequest.request.title ?? null}
    worktreeSourceSeed={$pendingComposeRequest.request.worktreeSource ?? null}
    worktreeBranchSeed={$pendingComposeRequest.request.worktreeBranch ?? null}
    onClose={controller.cancelCompose}
    onTaskSaved={controller.saveComposedTask}
    onRunAction={controller.runComposedTask}
  />
{/if}
