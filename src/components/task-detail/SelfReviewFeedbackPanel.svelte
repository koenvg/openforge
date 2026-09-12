<script lang="ts">
  import { CheckCircle2, MessageSquare } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import type { SelfReviewFeedbackPane } from './selfReviewFeedbackPane.svelte'
  import PrCommentsList from '../shared/pr/PrCommentsList.svelte'
  import { buildPrCommentUrl } from '../../lib/prCommentLinks'

  let { pane }: { pane: SelfReviewFeedbackPane } = $props()
  let linkedPr = $derived(pane.pullRequest.linkedPr)
  let prComments = $derived(pane.pullRequest.comments)
  let visibleComments = $derived(pane.pullRequest.visibleComments)
  let commentSelection = $derived(pane.pullRequest.selection)
  let markdownImageBaseUrl = $derived(pane.pullRequest.markdownImageBaseUrl)
  let resolveRemoteMedia = $derived(pane.pullRequest.resolveRemoteMedia)
  let onCommentClick = $derived(pane.pullRequest.onCommentClick)
  let onOpenLinkedPr = $derived(pane.pullRequest.onOpenLinkedPr)
  let showAddressed = $derived(pane.pullRequest.showAddressed)
  let onShowAddressedChange = $derived(pane.pullRequest.onShowAddressedChange)
</script>

<section class="flex h-full min-w-0 flex-col overflow-hidden bg-of-surface" aria-label="Feedback panel">
  {#if linkedPr}
    <div class="flex min-h-[calc(var(--of-control-height-touch)+0.5rem+var(--of-border-width))] shrink-0 flex-wrap items-center gap-2 border-b border-of-border bg-of-surface-subtle px-3 py-1">
      {#if commentSelection.selectedCount > 0}
        <span class="text-[13px] font-semibold text-of-accent">{commentSelection.selectedCount} selected</span>
        <Button variant="ghost" size="sm" onclick={commentSelection.deselectAll}>Clear</Button>
      {:else if commentSelection.unaddressedCount > 0}
        <Button variant="ghost" size="sm" onclick={commentSelection.selectAll}>Select all</Button>
      {/if}
      {#if commentSelection.addressedCount > 0}
        <Button variant="ghost" size="sm" onclick={() => onShowAddressedChange(!showAddressed)}>
          {showAddressed ? 'Hide addressed' : `Show ${commentSelection.addressedCount} addressed`}
        </Button>
      {/if}
      <Button variant="ghost" size="sm" type="button" onclick={onOpenLinkedPr}>GitHub ↗</Button>
    </div>
    {#if prComments.length === 0}
      <div class="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
        <MessageSquare size={28} strokeWidth={1.5} class="opacity-40" aria-hidden="true" />
        <p class="m-0 text-[13px] text-of-text/60">No review comments on this PR yet</p>
      </div>
    {:else if visibleComments.length === 0 && commentSelection.addressedCount > 0}
      <div class="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
        <CheckCircle2 size={28} strokeWidth={1.5} class="opacity-40" aria-hidden="true" />
        <p class="m-0 text-[13px] text-of-text/60">All comments addressed</p>
      </div>
    {:else}
      <div class="min-h-0 flex-1 overflow-y-auto p-3">
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
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <p class="m-0 text-[13px] text-of-text/60">No linked PR found</p>
    </div>
  {/if}
</section>
