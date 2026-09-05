<script lang="ts">
  import { CheckCircle2, RefreshCw, Send, Zap } from '@lucide/svelte'
  import { compileReviewPrompt, type ReviewPromptMode } from '../../lib/reviewPrompt'
  import type { PrComment, ReviewSubmissionComment } from '../../lib/types'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import Textarea from '@openforge-app/plugin-sdk/ui/Textarea.svelte'

  interface Props {
    layout?: 'bar' | 'sidebar'
    agentStatus: string | null
    onSendToAgent: (prompt: string) => void
    onRefresh: () => void
    selectedPrComments?: PrComment[]
    pendingInlineComments?: ReviewSubmissionComment[]
    onPendingInlineCommentsChange?: (comments: ReviewSubmissionComment[]) => void
    onSendComplete?: () => void
  }

  let { layout = 'bar', agentStatus, onSendToAgent, onRefresh, selectedPrComments = [], pendingInlineComments = [], onPendingInlineCommentsChange, onSendComplete }: Props = $props()

  let successMessage = $state<string | null>(null)
  let showPromptDialog = $state(false)
  let promptDraft = $state('')
  let promptMode = $state<ReviewPromptMode>('address')
  // Captured at dialog-open so toggling the mode can regenerate the prompt after
  // pending inline comments are cleared.
  let capturedInline = $state<{ path: string; line: number; body: string }[]>([])
  let capturedPr = $state<
    { body: string; author: string; file_path: string | null; line_number: number | null }[]
  >([])

  let inlineCount = $derived(pendingInlineComments.length)
  let prCommentCount = $derived(selectedPrComments.length)
  let hasComments = $derived(inlineCount > 0 || prCommentCount > 0)
  let isAgentBusy = $derived(agentStatus === 'running' || agentStatus === 'paused')
  let canSend = $derived(hasComments && !isAgentBusy)

  function openPromptDialog() {
    if (!canSend) return

    capturedInline = pendingInlineComments.map(c => ({ path: c.path, line: c.line, body: c.body }))
    capturedPr = selectedPrComments.map(c => ({
      body: c.body,
      author: c.author,
      file_path: c.file_path,
      line_number: c.line_number
    }))
    promptMode = 'address'
    promptDraft = compileReviewPrompt(promptMode, capturedInline, capturedPr)
    successMessage = null
    showPromptDialog = true
  }

  // Dispatches the (possibly edited) prompt the user reviewed in the dialog.
  function confirmSend() {
    onSendToAgent(promptDraft)
    onPendingInlineCommentsChange?.([])
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
    promptDraft = compileReviewPrompt(mode, capturedInline, capturedPr)
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
          <Badge variant="info">
            {inlineCount} inline {inlineCount === 1 ? 'comment' : 'comments'}
          </Badge>
        {/if}
        {#if prCommentCount > 0}
          <Badge variant="danger">
            {prCommentCount} PR {prCommentCount === 1 ? 'comment' : 'comments'}
          </Badge>
        {/if}
      </div>
    {:else}
      <span class="text-sm text-base-content/50 italic">No feedback collected yet</span>
    {/if}
  </div>

  <div class="flex shrink-0 items-center gap-2.5 {layout === 'sidebar' ? 'w-full' : ''}">
    {#if successMessage}
      <span class="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-success" aria-live="polite">
        <CheckCircle2 size={16} strokeWidth={1.8} aria-hidden="true" />
        {successMessage}
      </span>
    {/if}

    <Button
      variant="secondary"
      size="sm"
      class={layout === 'sidebar' ? 'flex-1' : ''}
      onclick={onRefresh}
      title="Refresh diff"
    >
      <RefreshCw size={17} strokeWidth={1.8} aria-hidden="true" />
      Refresh diff
    </Button>

    <Button
      size="sm"
      class={layout === 'sidebar' ? 'flex-[1.35]' : ''}
      onclick={openPromptDialog}
      disabled={!canSend}
      title={!hasComments ? 'Add comments before sending' : isAgentBusy ? 'Agent is currently running' : 'Review and send feedback to agent'}
    >
      <Send size={17} strokeWidth={1.8} aria-hidden="true" />
      Send to agent
    </Button>
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
      <Textarea
        label="Prompt sent to the agent"
        class="w-full font-mono text-[13px] leading-relaxed"
        rows={16}
        bind:value={promptDraft}
      />
      <div class="flex items-center gap-2">
        <Button variant="ghost" size="sm" class="mr-auto" onclick={cancelPromptDialog}>Cancel</Button>
        <div class="flex gap-1" role="group" aria-label="Prompt mode">
          <Button
            size="sm"
            variant={promptMode === 'address' ? 'primary' : 'ghost'}
            aria-pressed={promptMode === 'address'}
            title="Ask the agent to fix the comments"
            onclick={() => setPromptMode('address')}
          >Address</Button>
          <Button
            size="sm"
            variant={promptMode === 'analyze' ? 'primary' : 'ghost'}
            aria-pressed={promptMode === 'analyze'}
            title="Ask the agent to explain the comments without changing code"
            onclick={() => setPromptMode('analyze')}
          >Analyze</Button>
        </div>
        <Button
          size="sm"
          data-testid="confirm-send-prompt"
          onclick={confirmSend}
          disabled={!promptDraft.trim()}
        >
          <Send size={17} strokeWidth={1.8} aria-hidden="true" />
          Send to agent
        </Button>
      </div>
    </div>
  </Modal>
{/if}
