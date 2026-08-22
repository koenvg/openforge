<script lang="ts">
  import SelfReviewChangedFilesPanel from './SelfReviewChangedFilesPanel.svelte'
  import SelfReviewDiffPanel from './SelfReviewDiffPanel.svelte'
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
        files={controller.treeFiles}
        reviewedFileShas={controller.reviewedFileShas}
        getFileReviewIdentity={controller.getVisibleFileReviewIdentity}
        onToggleFileReviewed={controller.toggleFileReviewed}
        includeNonApplicationFiles={controller.includeNonApplicationFiles}
        nonApplicationFileCount={controller.nonApplicationFileCount}
        onToggleNonApplicationFiles={controller.setIncludeNonApplicationFiles}
        commits={controller.commits}
        selectedCommitSha={controller.selectedCommitSha}
        includeCommitted={controller.includeCommitted}
        includeUncommitted={controller.includeUncommitted}
        committedLocked={controller.committedLocked}
        uncommittedLocked={controller.uncommittedLocked}
        lockedScopeTooltip={controller.lockedScopeTooltip}
        onIncludeCommittedChange={controller.setIncludeCommitted}
        onIncludeUncommittedChange={controller.setIncludeUncommitted}
        onSelectCommit={controller.selectCommit}
        onSelectFile={controller.selectFile}
        onCollapse={() => controller.setFileTreeVisible(false)}
        onRequestFocusDiff={controller.focusDiff}
      />
    {/if}
    <SelfReviewDiffPanel
      {controller}
      onRequestFocusFileTree={() => changedFilesPanel?.focusTree()}
    />
    {#if controller.sidebarVisible}
      <SelfReviewFeedbackPanel
        taskId={controller.taskId}
        {agentStatus}
        {onSendToAgent}
        onRefresh={controller.refresh}
        linkedPr={controller.linkedPr}
        prComments={controller.prComments}
        commentSelection={controller.commentSelection}
        generalCommentCount={controller.generalCommentCount}
        pendingInlineComments={controller.pendingInlineComments}
        markdownImageBaseUrl={controller.markdownImageBaseUrl}
        onPendingInlineCommentsChange={controller.handlePendingInlineCommentsChange}
        onCommentClick={controller.scrollToComment}
        onOpenLinkedPr={controller.openLinkedPr}
        onCollapse={() => controller.setSidebarVisible(false)}
        activeTab={controller.sidebarTab}
        onActiveTabChange={controller.setSidebarTab}
        showAddressed={controller.showAddressed}
        onShowAddressedChange={controller.setShowAddressed}
      />
    {/if}
  </div>
</div>
