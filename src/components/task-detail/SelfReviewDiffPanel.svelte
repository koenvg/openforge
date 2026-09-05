<script lang="ts">
  import { AlertTriangle, FolderOpen } from '@lucide/svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import type DiffViewer from '../review/shared/diff-viewer/DiffViewer.svelte'
  import DiffViewerComponent from '../review/shared/diff-viewer/DiffViewer.svelte'
  import type { SelfReviewWorkspaceController } from './selfReviewWorkspaceController.svelte'

  interface Props {
    controller: SelfReviewWorkspaceController
    onRequestFocusFileTree: () => void
  }

  let { controller, onRequestFocusFileTree }: Props = $props()
  let diffViewer = $state<DiffViewer>()

  $effect(() => {
    controller.attachDiffViewer(diffViewer)
    if (!diffViewer || controller.isLoading) return
    void controller.restoreDiffScroll(diffViewer)
  })
</script>

<section class="flex min-w-0 flex-1 flex-col overflow-hidden bg-base-100" aria-label="Code diff panel">
  {#if controller.reviewedBaselineError}
    <div class="alert alert-error rounded-none border-x-0 border-t-0 py-2 text-sm" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <span>{controller.reviewedBaselineError}</span>
    </div>
  {/if}
  {#if controller.isLoading}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-base-content/60" role="status" aria-live="polite">
      <span class="loading loading-spinner loading-md text-primary"></span>
      <span>Loading diff...</span>
    </div>
  {:else if controller.error}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 p-5 text-center text-sm text-error" role="alert">
      <AlertTriangle size={40} strokeWidth={1.6} aria-hidden="true" />
      <span>{controller.error}</span>
      <Button size="sm" onclick={controller.refresh}>Retry loading diff</Button>
    </div>
  {:else if controller.visibleDiffFiles.length === 0}
    {#if !controller.includeNonApplicationFiles && controller.selfReviewDiffFiles.length > 0}
      <div class="flex flex-col items-center justify-center flex-1 gap-4 text-base-content/50 text-center p-10">
        <FolderOpen size={48} strokeWidth={1.4} aria-hidden="true" />
        <h3 class="text-xl font-semibold text-base-content m-0">Only non-application files changed</h3>
        <p class="text-sm m-0 max-w-md">
          All {controller.nonApplicationFileCount} changed {controller.nonApplicationFileCount === 1 ? 'file is a non-application file' : 'files are non-application files'} (tests, fixtures, snapshots, docs, or generated files), which are hidden by default.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onclick={() => controller.setIncludeNonApplicationFiles(true)}
        >
          Show non-application files
        </Button>
      </div>
    {:else}
      <div class="flex flex-col items-center justify-center flex-1 gap-4 text-base-content/50 text-center p-10">
        <FolderOpen size={48} strokeWidth={1.4} aria-hidden="true" />
        <h3 class="text-xl font-semibold text-base-content m-0">No changes for current selection</h3>
        <p class="text-sm m-0">
          {#if controller.selectedCommitSha === null}
            Make changes or enable uncommitted changes from the commit history pane.
          {:else}
            This commit has no displayable diff. Switch back to All changes from the commit history pane.
          {/if}
        </p>
        {#if !controller.fileTreeVisible}
          <Button
            variant="secondary"
            size="sm"
            onclick={() => controller.setFileTreeVisible(true)}
            title="Show file tree"
          >
            Show file tree
          </Button>
        {/if}
      </div>
    {/if}
  {:else}
    <DiffViewerComponent
      bind:this={diffViewer}
      files={controller.visibleDiffFiles}
      existingComments={controller.visibleInlineReviewComments}
      pendingComments={controller.visiblePendingInlineComments}
      onPendingCommentsChange={controller.handlePendingInlineCommentsChange}
      inlineDraftScopeId={controller.taskId}
      fileTreeVisible={controller.fileTreeVisible}
      onToggleFileTree={controller.toggleFileTree}
      {onRequestFocusFileTree}
      fetchFileContents={controller.fetchFileContents}
      batchFetchFileContents={controller.batchFetchFileContents}
      resolveRepositoryImage={controller.resolveRepositoryImage}
      onOpenRepositoryPath={controller.openRepositoryPath}
      includeCommitted={controller.includeCommitted}
      includeUncommitted={controller.includeUncommitted}
      initialScrollTop={controller.initialScrollTop}
      onScrollTopChange={controller.updateScrollTop}
      reviewedFileShas={controller.reviewedFileShas}
      onToggleFileReviewed={controller.toggleFileReviewed}
      getFileReviewIdentity={controller.getVisibleFileReviewIdentity}
    >
      {#snippet fileHeaderExtra(file)}
        {@const comparisonActive = controller.hasComparison(file.filename)}
        {#if comparisonActive || controller.hasReviewedBaselineChange(file)}
          <Button
            variant={comparisonActive ? 'outline' : 'ghost'}
            size="sm"
            class="flex-shrink-0"
            aria-label={comparisonActive ? `Show normal diff for ${file.filename}` : `Compare ${file.filename} with Reviewed File Snapshot`}
            title={comparisonActive ? 'Show the normal diff for this file' : 'Compare this file with the last version you marked reviewed'}
            onclick={() => comparisonActive
              ? controller.restoreFile(file)
              : controller.showChangesSinceReviewed(file)}
          >
            {comparisonActive ? 'Current diff' : 'Since reviewed'}
          </Button>
        {/if}
      {/snippet}
      {#snippet toolbarExtra()}
        <div class="w-px h-5 bg-base-300 mx-1 self-center"></div>
        <Button
          variant={controller.sidebarVisible ? 'outline' : 'ghost'}
          size="sm"
          aria-label="Toggle Feedback panel"
          aria-expanded={controller.sidebarVisible}
          onclick={controller.toggleSidebar}
          title={controller.sidebarVisible ? 'Collapse Feedback panel' : 'Show Feedback panel'}
        >
          Feedback
          {#if controller.commentSelection.unaddressedCount > 0 && !controller.sidebarVisible}
            <Badge variant="danger">{controller.commentSelection.unaddressedCount}</Badge>
          {/if}
        </Button>
      {/snippet}
    </DiffViewerComponent>
  {/if}
</section>
