<script lang="ts">
  import SelfReviewChangedFilesPanel from './SelfReviewChangedFilesPanel.svelte'
  import SelfReviewDiffPanel from './SelfReviewDiffPanel.svelte'
  import SelfReviewRepositoryPreview from './SelfReviewRepositoryPreview.svelte'
  import SelfReviewFeedbackPanel from './SelfReviewFeedbackPanel.svelte'
  import type { SelfReviewWorkspaceController } from './selfReviewWorkspaceController.svelte'

  interface Props {
    controller: SelfReviewWorkspaceController
    agentStatus: string | null
    onSendToAgent: (prompt: string) => void
  }

  let { controller, agentStatus, onSendToAgent }: Props = $props()
  let changedFilesPanel = $state<SelfReviewChangedFilesPanel>()
</script>

<div class="flex h-full w-full flex-col overflow-hidden" style="background: var(--of-review-canvas)">
  <div class="flex flex-1 overflow-hidden">
    {#if controller.fileTreeVisible}
      <SelfReviewChangedFilesPanel
        bind:this={changedFilesPanel}
        pane={controller.changedFilesPane}
      />
    {/if}
    <div class="relative flex min-w-0 flex-1 overflow-hidden">
      <SelfReviewDiffPanel
        {controller}
        onRequestFocusFileTree={() => changedFilesPanel?.focusTree()}
      />
      {#if controller.repositoryPreview}
        <SelfReviewRepositoryPreview
          target={controller.repositoryPreview}
          selectedCommitSha={controller.selectedCommitSha}
          fetchContent={controller.fetchRepositoryFile}
          resolveRepositoryImage={controller.resolveRepositoryImage}
          onOpenRepositoryPath={controller.openRepositoryPath}
          onClose={controller.closeRepositoryPreview}
        />
      {/if}
    </div>
    {#if controller.sidebarVisible}
      <SelfReviewFeedbackPanel
        pane={controller.feedbackPane}
        {agentStatus}
        {onSendToAgent}
      />
    {/if}
  </div>
</div>
