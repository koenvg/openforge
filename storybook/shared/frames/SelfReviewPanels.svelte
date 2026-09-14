<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import SelfReviewChangedFilesPanel from '../../../src/components/task-detail/SelfReviewChangedFilesPanel.svelte'
  import SelfReviewDiffPanel from '../../../src/components/task-detail/SelfReviewDiffPanel.svelte'
  import SelfReviewFeedbackPanel from '../../../src/components/task-detail/SelfReviewFeedbackPanel.svelte'
  import SendToAgentPanel from '../../../src/components/task-detail/SendToAgentPanel.svelte'
  import { createSelfReviewWorkspaceController } from '../../../src/components/task-detail/selfReviewWorkspaceController.svelte'

  let { panel, taskId = 'T-42', onSendToAgent, agentStatus = 'completed' }: {
    panel: 'files' | 'diff' | 'feedback'
    taskId?: string
    agentStatus?: string
    onSendToAgent: (prompt: string) => void
  } = $props()
  const controller = createSelfReviewWorkspaceController({ getTaskId: () => taskId })
  $effect(() => { controller.synchronizeWorkspaceState() })
  onMount(() => { void controller.load() })
  onDestroy(() => controller.dispose())
</script>

<div class="flex h-screen min-h-0 w-full flex-col overflow-hidden">
  {#if panel === 'feedback'}
    <SendToAgentPanel
      {agentStatus}
      {onSendToAgent}
      onRefresh={controller.refresh}
      feedback={controller.feedbackPane.composer}
    />
  {/if}
  <div class="grid min-h-0 flex-1 overflow-hidden">
    {#if panel === 'files'}
      <SelfReviewChangedFilesPanel pane={controller.changedFilesPane} />
    {:else if panel === 'diff'}
      <SelfReviewDiffPanel {controller} onRequestFocusFileTree={() => {}} />
    {:else}
      <SelfReviewFeedbackPanel pane={controller.feedbackPane} />
    {/if}
  </div>
</div>
