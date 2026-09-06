<script lang="ts">
  import AddTaskDialog from '../AddTaskDialog.svelte'
  import { activeProjectId } from '../../lib/stores'
  import { pendingComposeRequest, type PendingComposeRequest } from '../../lib/taskCompose'
  import type { AppTaskCreationController } from '../../lib/appTaskCreationController.svelte'

  interface Props {
    controller: AppTaskCreationController
    projectPath: string | null
    projectName: string | null
  }

  let { controller, projectPath, projectName }: Props = $props()
  // Reporting a composed task settles its caller before starting. Keep the
  // dialog mounted until its workflow closes, so a start failure is recoverable.
  let savedComposeRequest = $state.raw<PendingComposeRequest | null>(null)
  const composeRequest = $derived($pendingComposeRequest ?? savedComposeRequest)
  $effect(() => {
    if ($pendingComposeRequest && $pendingComposeRequest !== savedComposeRequest) {
      savedComposeRequest = null
    }
  })
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

{#if composeRequest}
  {@const request = composeRequest}
  {#key request}
    <AddTaskDialog
      mode="create"
      {projectPath}
      promptSeed={request.request.initialPrompt}
      sourceTicketUrlSeed={request.request.sourceTicketUrl ?? null}
      titleSeed={request.request.title ?? null}
      worktreeSourceSeed={request.request.worktreeSource ?? null}
      worktreeBranchSeed={request.request.worktreeBranch ?? null}
      onClose={() => {
        if (savedComposeRequest === request) savedComposeRequest = null
        if (!$pendingComposeRequest || $pendingComposeRequest === request) controller.cancelCompose()
      }}
      onTaskSaved={async (task, options) => {
        savedComposeRequest = request
        await controller.saveComposedTask(task, options)
      }}
      onRunAction={controller.runComposedTask}
    />
  {/key}
{/if}
