<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import TerminalTaskConfirmationDialog from '../../../src/components/shared/tasks/TerminalTaskConfirmationDialog.svelte'
  import {
    requestTerminalTaskConfirmation,
    resolveTerminalTaskConfirmation,
    type TerminalTaskAction,
  } from '../../../src/lib/terminalTaskConfirmation'

  let { action = 'Complete', taskId = 'T-42', onAnswer = () => {} }: {
    action?: TerminalTaskAction
    taskId?: string
    onAnswer?: (confirmed: boolean) => void
  } = $props()

  onMount(() => {
    void requestTerminalTaskConfirmation(action, taskId).then(onAnswer)
  })
  onDestroy(() => resolveTerminalTaskConfirmation(false))
</script>

<TerminalTaskConfirmationDialog />
