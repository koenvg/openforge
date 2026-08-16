<script lang="ts">
  import { AlertTriangle, CheckCircle2, RefreshCw, Send, Zap } from '@lucide/svelte'
  import {
    selfReviewStateByTask,
    setSelfReviewArchivedComments,
    setSelfReviewGeneralComments,
  } from '../../lib/taskScopedSelfReviewState'
  import { archiveSelfReviewComments, getActiveSelfReviewComments, getArchivedSelfReviewComments } from '../../lib/ipc'
  import { compileReviewPrompt, type ReviewPromptMode } from '../../lib/reviewPrompt'
  import type { PrComment, ReviewSubmissionComment } from '../../lib/types'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'

  interface Props {
    taskId: string
    layout?: 'bar' | 'sidebar'
    agentStatus: string | null
    onSendToAgent: (prompt: string) => void
    onRefresh: () => void
    selectedPrComments?: PrComment[]
    pendingInlineComments?: ReviewSubmissionComment[]
    onPendingInlineCommentsChange?: (comments: ReviewSubmissionComment[]) => void
    onSendComplete?: () => void
  }

  let { taskId, layout = 'bar', agentStatus, onSendToAgent, onRefresh, selectedPrComments = [], pendingInlineComments = [], onPendingInlineCommentsChange, onSendComplete }: Props = $props()

  let isSending = $state(false)
  let error = $state<string | null>(null)
  let successMessage = $state<string | null>(null)
  let showPromptDialog = $state(false)
  let promptDraft = $state('')
  let promptMode = $state<ReviewPromptMode>('address')
  // Captured at dialog-open so toggling the mode can regenerate the prompt even
  // after the source comment stores have been archived/cleared.
  let capturedInline = $state<{ path: string; line: number; body: string }[]>([])
  let capturedGeneral = $state<{ body: string }[]>([])
  let capturedPr = $state<
    { body: string; author: string; file_path: string | null; line_number: number | null }[]
  >([])

  let selfReviewState = $derived($selfReviewStateByTask.get(taskId))
  let selfReviewGeneralComments = $derived(selfReviewState?.generalComments ?? [])
  let inlineCount = $derived(pendingInlineComments.length)
  let generalCount = $derived(selfReviewGeneralComments.length)
  let prCommentCount = $derived(selectedPrComments.length)
  let hasComments = $derived(inlineCount > 0 || generalCount > 0 || prCommentCount > 0)
  let isAgentBusy = $derived(agentStatus === 'running' || agentStatus === 'paused')
  let canSend = $derived(hasComments && !isAgentBusy && !isSending)

  // Opens the editable-prompt dialog. Archive timing is unchanged from before the
  // dialog existed: comments are archived here (when the prompt is compiled), not on
  // confirm — so cancelling the dialog still archives, as agreed for this change.
  async function openPromptDialog() {
    if (!canSend) return

    capturedInline = pendingInlineComments.map(c => ({ path: c.path, line: c.line, body: c.body }))
    capturedGeneral = selfReviewGeneralComments.map(c => ({ body: c.body }))
    capturedPr = selectedPrComments.map(c => ({
      body: c.body,
      author: c.author,
      file_path: c.file_path,
      line_number: c.line_number
    }))
    promptMode = 'address'
    promptDraft = compileReviewPrompt(promptMode, capturedInline, capturedGeneral, capturedPr)

    isSending = true
    error = null
    successMessage = null

    try {
      // CRITICAL ORDER: archive → clear stores → reload
      await archiveSelfReviewComments(taskId)

      // Clear task-scoped inline comments from store
      onPendingInlineCommentsChange?.([])

      // Reload archived comments into store
      const archived = await getArchivedSelfReviewComments(taskId)
      setSelfReviewArchivedComments(taskId, archived.filter(c => c.comment_type === 'general'))

      // Reload active comments (should be empty after archive)
      const active = await getActiveSelfReviewComments(taskId)
      setSelfReviewGeneralComments(taskId, active.filter(c => c.comment_type === 'general'))

      showPromptDialog = true
    } catch (e) {
      console.error('Failed to prepare feedback:', e)
      error = 'Failed to prepare feedback. Please try again.'
    } finally {
      isSending = false
    }
  }

  // Dispatches the (possibly edited) prompt the user reviewed in the dialog.
  function confirmSend() {
    onSendToAgent(promptDraft)
    showPromptDialog = false
    successMessage = 'Feedback sent to agent!'
    setTimeout(() => {
      successMessage = null
    }, 3000)
    onSendComplete?.()
  }

  function cancelPromptDialog() {
    showPromptDialog = false
  }

  // Switching mode regenerates the prompt from the captured comments (overwriting
  // any manual edits), so each mode shows its own template.
  function setPromptMode(mode: ReviewPromptMode) {
    promptMode = mode
    promptDraft = compileReviewPrompt(mode, capturedInline, capturedGeneral, capturedPr)
  }
</script>

{#if isAgentBusy}
  <div class="flex items-center gap-2 border-y border-warning/30 bg-warning/10 px-4 py-2 text-[13px] font-medium text-warning">
    <Zap size={17} strokeWidth={1.8} class="shrink-0" aria-hidden="true" />
    <span>Agent is working — diff may be stale. Refresh when ready.</span>
  </div>
{/if}

<div class="{layout === 'sidebar' ? 'flex flex-col gap-3 border-t border-base-300 bg-base-100 p-3' : 'flex min-h-14 items-center justify-between gap-4 border-t border-base-300 bg-base-200 px-6 py-3'}">
  <div class="flex items-center gap-2 flex-1 min-w-0">
    {#if hasComments}
      <div class="flex items-center gap-2 flex-wrap">
        {#if inlineCount > 0}
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-primary/25 bg-primary/12 px-2.5 py-1 text-[13px] font-semibold text-primary">
            <span class="inline-block w-[5px] h-[5px] rounded-full bg-current shrink-0"></span>
            {inlineCount} inline {inlineCount === 1 ? 'comment' : 'comments'}
          </span>
        {/if}
        {#if generalCount > 0}
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-warning/25 bg-warning/12 px-2.5 py-1 text-[13px] font-semibold text-warning">
            <span class="inline-block w-[5px] h-[5px] rounded-full bg-current shrink-0"></span>
            {generalCount} general {generalCount === 1 ? 'comment' : 'comments'}
          </span>
        {/if}
        {#if prCommentCount > 0}
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-error/25 bg-error/12 px-2.5 py-1 text-[13px] font-semibold text-error">
            <span class="inline-block w-[5px] h-[5px] rounded-full bg-current shrink-0"></span>
            {prCommentCount} PR {prCommentCount === 1 ? 'comment' : 'comments'}
          </span>
        {/if}
      </div>
    {:else}
      <span class="text-sm text-base-content/50 italic">No feedback collected yet</span>
    {/if}
  </div>

  <div class="flex shrink-0 items-center gap-2.5 {layout === 'sidebar' ? 'w-full' : ''}">
    {#if error}
      <span class="inline-flex max-w-[280px] items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-error" role="alert">
        <AlertTriangle size={16} strokeWidth={1.8} aria-hidden="true" />
        {error}
      </span>
    {/if}
    {#if successMessage}
      <span class="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-success" aria-live="polite">
        <CheckCircle2 size={16} strokeWidth={1.8} aria-hidden="true" />
        {successMessage}
      </span>
    {/if}

    <button
      class="btn btn-soft btn-sm h-10 min-h-10 shadow-sm transition-shadow hover:shadow-md {layout === 'sidebar' ? 'flex-1' : ''}"
      onclick={onRefresh}
      disabled={isSending}
      title="Refresh diff"
    >
      <RefreshCw size={17} strokeWidth={1.8} aria-hidden="true" />
      Refresh diff
    </button>

    <button
      class="btn btn-primary btn-sm h-10 min-h-10 font-semibold tracking-wide shadow-sm transition-shadow hover:shadow-md {layout === 'sidebar' ? 'flex-[1.35]' : ''}"
      onclick={openPromptDialog}
      disabled={!canSend}
      title={!hasComments ? 'Add comments before sending' : isAgentBusy ? 'Agent is currently running' : 'Review and send feedback to agent'}
    >
      {#if isSending}
        <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
        Preparing…
      {:else}
        <Send size={17} strokeWidth={1.8} aria-hidden="true" />
        Send to agent
      {/if}
    </button>
  </div>
</div>

{#if showPromptDialog}
  <Modal
    onClose={cancelPromptDialog}
    maxWidth="760px"
    initialFocus="textarea"
    ariaLabel="Review the prompt before sending to the agent"
  >
    {#snippet header()}
      <h2 class="text-base font-semibold m-0">Review prompt before sending</h2>
    {/snippet}
    <div class="flex flex-col gap-3 px-5 py-4">
      <p class="m-0 text-[13px] text-base-content/60">
        Edit the prompt below if you like — the agent receives exactly this text.
        Switching mode regenerates it.
      </p>
      <textarea
        class="textarea textarea-bordered min-h-80 w-full font-mono text-[13px] leading-relaxed"
        bind:value={promptDraft}
        aria-label="Prompt sent to the agent"
      ></textarea>
      <div class="flex items-center gap-2">
        <button class="btn btn-ghost btn-sm mr-auto" onclick={cancelPromptDialog}>Cancel</button>
        <div class="join" role="group" aria-label="Prompt mode">
          <button
            class="btn btn-sm join-item {promptMode === 'address' ? 'btn-primary' : 'btn-ghost'}"
            aria-pressed={promptMode === 'address'}
            title="Ask the agent to fix the comments"
            onclick={() => setPromptMode('address')}
          >Address</button>
          <button
            class="btn btn-sm join-item {promptMode === 'analyze' ? 'btn-primary' : 'btn-ghost'}"
            aria-pressed={promptMode === 'analyze'}
            title="Ask the agent to explain the comments without changing code"
            onclick={() => setPromptMode('analyze')}
          >Analyze</button>
        </div>
        <button
          class="btn btn-primary btn-sm font-semibold"
          data-testid="confirm-send-prompt"
          onclick={confirmSend}
          disabled={!promptDraft.trim()}
        >
          <Send size={17} strokeWidth={1.8} aria-hidden="true" />
          Send to agent
        </button>
      </div>
    </div>
  </Modal>
{/if}
