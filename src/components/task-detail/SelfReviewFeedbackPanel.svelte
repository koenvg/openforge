<script lang="ts">
  import { CheckCircle2, MessageSquare } from '@lucide/svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import type { CommentSelectionState } from '../../lib/useCommentSelection.svelte'
  import type { PrComment, PullRequestInfo, ReviewSubmissionComment } from '../../lib/types'
  import GeneralCommentsSidebar from '../review/shared/GeneralCommentsSidebar.svelte'
  import PrCommentsList from '../shared/pr/PrCommentsList.svelte'
  import { buildPrCommentUrl } from '../../lib/prCommentLinks'
  import SendToAgentPanel from './SendToAgentPanel.svelte'

  interface Props {
    taskId: string
    agentStatus: string | null
    onSendToAgent: (prompt: string) => void
    onRefresh: () => void | Promise<void>
    linkedPr: PullRequestInfo | null
    prComments: PrComment[]
    commentSelection: CommentSelectionState
    generalCommentCount: number
    pendingInlineComments: ReviewSubmissionComment[]
    markdownImageBaseUrl: string | null
    onPendingInlineCommentsChange: (comments: ReviewSubmissionComment[]) => void
    onCommentClick: (comment: PrComment) => void
    onOpenLinkedPr: () => void
    onCollapse: () => void
    activeTab: 'pr' | 'notes'
    onActiveTabChange: (tab: 'pr' | 'notes') => void
    showAddressed: boolean
    onShowAddressedChange: (showAddressed: boolean) => void
  }

  let {
    taskId,
    agentStatus,
    onSendToAgent,
    onRefresh,
    linkedPr,
    prComments,
    commentSelection,
    generalCommentCount,
    pendingInlineComments,
    markdownImageBaseUrl,
    onPendingInlineCommentsChange,
    onCommentClick,
    onOpenLinkedPr,
    onCollapse,
    activeTab,
    onActiveTabChange,
    showAddressed,
    onShowAddressedChange,
  }: Props = $props()
  let visibleComments = $derived(showAddressed ? prComments : commentSelection.unaddressedComments)
  let totalCommentCount = $derived(
    commentSelection.unaddressedCount + generalCommentCount + pendingInlineComments.length,
  )
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
    <div class="flex items-center border-b border-base-300 bg-base-200 shrink-0">
      <button
        class="min-h-10 flex-1 px-3 py-2 text-center text-[13px] font-semibold transition-colors {activeTab === 'pr' ? 'text-primary border-b-2 border-primary bg-base-100' : 'text-base-content/60 hover:text-base-content hover:bg-base-content/5'}"
        onclick={() => onActiveTabChange('pr')}
      >
        PR Comments
        {#if commentSelection.unaddressedCount > 0}<span class="badge badge-error badge-xs ml-1">{commentSelection.unaddressedCount}</span>{/if}
      </button>
      <button
        class="min-h-10 flex-1 px-3 py-2 text-center text-[13px] font-semibold transition-colors {activeTab === 'notes' ? 'text-primary border-b-2 border-primary bg-base-100' : 'text-base-content/60 hover:text-base-content hover:bg-base-content/5'}"
        onclick={() => onActiveTabChange('notes')}
      >
        General feedback
        {#if generalCommentCount > 0}<span class="badge badge-ghost badge-xs ml-1">{generalCommentCount}</span>{/if}
      </button>
    </div>
    <div class="flex-1 overflow-hidden flex flex-col" class:hidden={activeTab !== 'pr'}>
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

    <div class="flex-1 overflow-hidden" class:hidden={activeTab !== 'notes'}>
      <GeneralCommentsSidebar {taskId} />
    </div>
    <SendToAgentPanel
      layout="sidebar"
      {taskId}
      {agentStatus}
      {onSendToAgent}
      {onRefresh}
      selectedPrComments={commentSelection.selectedPrComments}
      {pendingInlineComments}
      {onPendingInlineCommentsChange}
      onSendComplete={commentSelection.deselectAll}
    />
  </section>
</ResizablePanel>
