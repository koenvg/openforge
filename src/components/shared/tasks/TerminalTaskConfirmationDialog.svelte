<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import { getTaskGitStatus } from '../../../lib/ipc'
  import { activeSessions } from '../../../lib/stores'
  import { activeTasks } from '../../../lib/tasksState'
  import {
    describeCompletionLoss,
    resolveTerminalTaskConfirmation,
    terminalTaskConfirmationRequest,
    type CompletionLoss,
    type TerminalTaskConfirmationRequest,
  } from '../../../lib/terminalTaskConfirmation'

  type WorktreeCheck =
    | { state: 'checking' }
    | { state: 'checked'; loss: CompletionLoss }
    | { state: 'failed' }

  const request = $derived($terminalTaskConfirmationRequest)
  const task = $derived(request ? $activeTasks.find((candidate) => candidate.id === request.taskId) ?? null : null)
  const taskTitle = $derived(task?.title ? `“${task.title}”` : 'this task')
  const agentRunning = $derived(request ? $activeSessions.get(request.taskId)?.status === 'running' : false)

  let worktreeCheck = $state<WorktreeCheck>({ state: 'checking' })
  let checkedRequest: TerminalTaskConfirmationRequest | null = null

  const loss = $derived(worktreeCheck.state === 'checked' ? worktreeCheck.loss : null)
  const losesWork = $derived(loss !== null && (loss.discardedFiles > 0 || loss.lostCommits > 0))
  const confirmLabel = $derived(
    request?.action === 'Delete' ? 'Delete task' : losesWork ? 'Discard work and complete' : 'Complete task',
  )
  const confirmDisabled = $derived(request?.action === 'Complete' && worktreeCheck.state === 'checking')

  $effect(() => {
    if (request?.action === 'Complete' && request !== checkedRequest) {
      checkedRequest = request
      void checkWorktree(request, task?.worktreeSource ?? null)
    }
  })

  async function checkWorktree(
    current: TerminalTaskConfirmationRequest,
    worktreeSource: Parameters<typeof describeCompletionLoss>[1],
  ): Promise<void> {
    worktreeCheck = { state: 'checking' }
    try {
      const status = await getTaskGitStatus(current.taskId)
      if (checkedRequest === current) {
        worktreeCheck = { state: 'checked', loss: describeCompletionLoss(status, worktreeSource) }
      }
    } catch {
      if (checkedRequest === current) worktreeCheck = { state: 'failed' }
    }
  }

  function discardedFilesWarning(count: number): string {
    return count === 1
      ? '1 file has changes that aren’t committed. Completing deletes it.'
      : `${count} files have changes that aren’t committed. Completing deletes them.`
  }

  function lostCommitsWarning(count: number): string {
    return count === 1
      ? '1 commit on this branch was never pushed. Completing deletes the branch and the commit with it.'
      : `${count} commits on this branch were never pushed. Completing deletes the branch and the commits with it.`
  }

  function cancel(): void {
    resolveTerminalTaskConfirmation(false)
  }

  function confirm(): void {
    resolveTerminalTaskConfirmation(true)
  }
</script>

{#if request}
  <Modal
    onClose={cancel}
    maxWidth="420px"
    initialFocus="[data-terminal-task-confirm='cancel']"
    ariaLabelledby="terminal-task-confirmation-title"
  >
    {#snippet header()}
      <h2 id="terminal-task-confirmation-title" class="text-[0.95rem] font-semibold text-of-text m-0 [overflow-wrap:anywhere]">
        {request.action} {taskTitle}?
      </h2>
    {/snippet}
    <div class="p-5 flex flex-col gap-4 text-sm">
      {#if request.action === 'Delete'}
        <p class="m-0 text-of-text/70">OpenForge deletes this backlog task permanently. Unlike a completed task, agents can’t look it up afterwards.</p>
      {:else}
        <p class="m-0 text-of-text/70">
          OpenForge stops this task’s agent and terminals and deletes its worktree folder. The task then leaves the board. The app doesn’t list completed tasks, but agents can still look this one up with <code>openforge task completed</code>.
        </p>
        {#if worktreeCheck.state === 'checking'}
          <p class="m-0 text-of-text/50" role="status">Checking the worktree for work that isn’t saved…</p>
        {:else if worktreeCheck.state === 'failed'}
          <p class="m-0 text-of-warning" role="status">OpenForge couldn’t check the worktree, so it can’t tell whether anything would be lost.</p>
        {:else if !losesWork}
          <p class="m-0 text-of-text/70" role="status">Nothing in the worktree would be lost.</p>
        {/if}
        {#if losesWork || agentRunning}
          <ul class="m-0 p-0 list-none flex flex-col gap-2 text-of-danger" role="alert">
            {#if loss && loss.discardedFiles > 0}
              <li>{discardedFilesWarning(loss.discardedFiles)}</li>
            {/if}
            {#if loss && loss.lostCommits > 0}
              <li>{lostCommitsWarning(loss.lostCommits)}</li>
            {/if}
            {#if agentRunning}
              <li>The agent is still working. Completing stops it.</li>
            {/if}
          </ul>
        {/if}
      {/if}
      <div class="flex justify-end gap-2">
        <Button data-terminal-task-confirm="cancel" variant="ghost" size="sm" type="button" onclick={cancel}>Cancel</Button>
        <Button variant="danger" size="sm" type="button" disabled={confirmDisabled} onclick={confirm}>{confirmLabel}</Button>
      </div>
    </div>
  </Modal>
{/if}
