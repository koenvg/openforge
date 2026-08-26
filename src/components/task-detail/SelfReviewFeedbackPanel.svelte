<script lang="ts">
  import { CheckCircle2, MessageSquare } from '@lucide/svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import type { SelfReviewFeedbackPane } from './selfReviewFeedbackPane.svelte'
  import PrCommentsList from '../shared/pr/PrCommentsList.svelte'
  import { buildPrCommentUrl } from '../../lib/prCommentLinks'
  import SendToAgentPanel from './SendToAgentPanel.svelte'

  interface Props {
    pane: SelfReviewFeedbackPane
    agentStatus: string | null
    onSendToAgent: (prompt: string) => void
  }

  let { pane, agentStatus, onSendToAgent }: Props = $props()
  let onRefresh = $derived(pane.pullRequest.onRefresh)
  let linkedPr = $derived(pane.pullRequest.linkedPr)
  let prComments = $derived(pane.pullRequest.comments)
  let visibleComments = $derived(pane.pullRequest.visibleComments)
  let commentSelection = $derived(pane.pullRequest.selection)
  let pendingInlineComments = $derived(pane.composer.pendingInlineComments)
  let markdownImageBaseUrl = $derived(pane.pullRequest.markdownImageBaseUrl)
  let resolveRemoteMedia = $derived(pane.pullRequest.resolveRemoteMedia)
  let onPendingInlineCommentsChange = $derived(pane.composer.onPendingInlineCommentsChange)
  let onSendComplete = $derived(pane.composer.onSendComplete)
  let onCommentClick = $derived(pane.pullRequest.onCommentClick)
  let onOpenLinkedPr = $derived(pane.pullRequest.onOpenLinkedPr)
  let onCollapse = $derived(pane.navigation.onCollapse)
  let showAddressed = $derived(pane.pullRequest.showAddressed)
  let onShowAddressedChange = $derived(pane.pullRequest.onShowAddressedChange)
  let totalCommentCount = $derived(pane.totalCommentCount)
</script>

<ResizablePanel storageKey="self-review-comments" defaultWidth={380} minWidth={300} maxWidth={620} side="right" label="Feedback">
  <section class="flex h-full flex-col overflow-hidden border-l border-base-300 bg-base-100" aria-label="Feedback panel">
    <div class="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-2">
      <div class="flex min-w-0 items-baseline gap-2">
        <h2 class="m-0 text-sm font-semibold text-base-content">Feedback</h2>
        <p class="m-0 whitespace-nowrap text-xs text-base-content/60">{totalCommentCount} comments</p>
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-sm h-10 min-h-10 w-10 p-0 text-base-content/60"
        aria-label="Collapse Feedback panel"
        title="Collapse Feedback"
        onclick={onCollapse}
      ><span aria-hidden="true">››</span></button>
    </div>
    <div class="flex-1 overflow-hidden flex flex-col">
      {#if linkedPr}
        <div class="flex items-center gap-2 px-3 py-2 bg-base-200/50 border-b border-base-300 shrink-0">
          {#if commentSelection.selectedCount > 0}
            <span class="text-[13px] font-semibold text-primary">{commentSelection.selectedCount} selected</span>
            <button class="btn btn-ghost btn-sm h-10 min-h-10 text-[13px] text-base-content/60 hover:text-base-content" onclick={commentSelection.deselectAll}>Clear</button>
          {:else if commentSelection.unaddressedCount > 0}
            <button class="btn btn-ghost btn-sm h-10 min-h-10 text-[13px] text-base-content/60 hover:text-primary" onclick={commentSelection.selectAll}>Select all</button>
          {/if}
          <span class="flex-1"></span>
          {#if commentSelection.addressedCount > 0}
            <button
              class="btn btn-ghost btn-sm h-10 min-h-10 text-[13px] text-base-content/60"
              onclick={() => onShowAddressedChange(!showAddressed)}
            >
              {showAddressed ? 'Hide addressed' : `Show ${commentSelection.addressedCount} addressed`}
            </button>
          {/if}
          <button
            type="button"
            class="btn btn-ghost btn-sm h-10 min-h-10 px-2 text-[13px] text-primary"
            onclick={onOpenLinkedPr}
          >GitHub ↗</button>
        </div>
        {#if prComments.length === 0}
          <div class="flex flex-col items-center justify-center flex-1 gap-2 px-4 py-8 text-center">
            <MessageSquare size={28} strokeWidth={1.5} class="opacity-40" aria-hidden="true" />
            <p class="m-0 text-[13px] text-base-content/60">No review comments on this PR yet</p>
          </div>
        {:else if visibleComments.length === 0 && commentSelection.addressedCount > 0}
          <div class="flex flex-col items-center justify-center flex-1 gap-2 px-4 py-8 text-center">
            <CheckCircle2 size={28} strokeWidth={1.5} class="opacity-40" aria-hidden="true" />
            <p class="m-0 text-[13px] text-base-content/60">All comments addressed</p>
          </div>
        {:else}
          <div class="flex-1 overflow-y-auto p-3">
            <PrCommentsList
              comments={visibleComments}
              imageBaseUrlForComment={() => markdownImageBaseUrl}
              {resolveRemoteMedia}
              showLocation={true}
              showMarkAddressed={true}
              onMarkAddressed={commentSelection.markAddressed}
              isAddressing={commentSelection.isAddressing}
              addressErrorFor={commentSelection.addressErrorFor}
              density="detail"
              selectable={true}
              selectedIds={commentSelection.selectedPrCommentIds}
              onToggleSelect={commentSelection.toggleSelected}
              commentUrl={(comment) => buildPrCommentUrl(comment, linkedPr.url)}
              {onCommentClick}
              showAuthorFilter={true}
              showTimestamp={true}
            />
          </div>
        {/if}
      {:else}
        <div class="flex flex-col items-center justify-center flex-1 gap-2 px-4 py-8 text-center">
          <p class="m-0 text-[13px] text-base-content/60">No linked PR found</p>
        </div>
      {/if}
    </div>

    <SendToAgentPanel
      layout="sidebar"
      {agentStatus}
      {onSendToAgent}
      {onRefresh}
      selectedPrComments={commentSelection.selectedPrComments}
      {pendingInlineComments}
      {onPendingInlineCommentsChange}
      {onSendComplete}
    />
  </section>
</ResizablePanel>
