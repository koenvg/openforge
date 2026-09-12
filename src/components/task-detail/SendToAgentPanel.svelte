<script lang="ts">
  import { onDestroy } from 'svelte'
  import { CheckCircle2, RefreshCw, Send } from '@lucide/svelte'
  import { compileReviewPrompt, type ReviewPromptMode } from '../../lib/reviewPrompt'
  import type { PrComment, ReviewSubmissionComment } from '../../lib/types'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import Textarea from '@openforge-app/plugin-sdk/ui/Textarea.svelte'

  interface Props {
    agentStatus: string | null
    onSendToAgent: (prompt: string) => void
    onRefresh: () => void
    selectedPrComments?: PrComment[]
    pendingInlineComments?: ReviewSubmissionComment[]
    onPendingInlineCommentsChange?: (comments: ReviewSubmissionComment[]) => void
    onSendComplete?: (sentPrCommentIds: number[]) => void
  }

  let { agentStatus, onSendToAgent, onRefresh, selectedPrComments = [], pendingInlineComments = [], onPendingInlineCommentsChange, onSendComplete }: Props = $props()

  const isMac = navigator.platform.startsWith('Mac')

  let successMessage = $state<string | null>(null)
  let successTimer: ReturnType<typeof setTimeout> | undefined
  let showPromptDialog = $state(false)
  let promptDraft = $state('')
  let promptMode = $state<ReviewPromptMode>('address')
  let capturedInline = $state<ReviewSubmissionComment[]>([])
  let capturedPr = $state<PrComment[]>([])

  let inlineCount = $derived(pendingInlineComments.length)
  let prCommentCount = $derived(selectedPrComments.length)
  let hasComments = $derived(inlineCount > 0 || prCommentCount > 0)
  let isAgentBusy = $derived(agentStatus === 'running' || agentStatus === 'paused')
  let canSend = $derived(hasComments && !isAgentBusy)

  onDestroy(() => clearTimeout(successTimer))

  function openPromptDialog() {
    if (!canSend) return

    capturedInline = pendingInlineComments.map(comment => ({ ...comment }))
    capturedPr = selectedPrComments.map(comment => ({ ...comment }))
    promptMode = 'address'
    promptDraft = compileReviewPrompt(promptMode, capturedInline, capturedPr)
    successMessage = null
    showPromptDialog = true
  }

  // Dispatches the (possibly edited) prompt the user reviewed in the dialog.
  function confirmSend() {
    if (isAgentBusy || !promptDraft.trim()) return
    onSendToAgent(promptDraft)
    const unmatchedCapturedInline = [...capturedInline]
    onPendingInlineCommentsChange?.(pendingInlineComments.filter(comment => {
      const capturedIndex = unmatchedCapturedInline.findIndex(sent =>
        sent.path === comment.path && sent.line === comment.line
        && sent.side === comment.side && sent.body === comment.body)
      if (capturedIndex < 0) return true
      unmatchedCapturedInline.splice(capturedIndex, 1)
      return false
    }))
    showPromptDialog = false
    successMessage = 'Feedback sent to agent!'
    clearTimeout(successTimer)
    successTimer = setTimeout(() => {
      successTimer = undefined
      successMessage = null
    }, 3000)
    onSendComplete?.(selectedPrComments.filter(comment => capturedPr.some(sent =>
      sent.id === comment.id && sent.body === comment.body && sent.author === comment.author
      && sent.file_path === comment.file_path && sent.line_number === comment.line_number,
    )).map(comment => comment.id))
  }

  function handlePromptKeydown(event: KeyboardEvent) {
    if (event.isComposing || event.repeat || event.altKey || event.shiftKey) return
    if (event.key !== 'Enter' || !(isMac ? event.metaKey : event.ctrlKey)) return
    confirmSend()
    return true
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

<div class="flex min-w-0 flex-wrap items-center gap-2">
  <div class="flex min-w-0 flex-wrap items-center gap-2.5">
    {#if successMessage}
      <span class="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-success" aria-live="polite">
        <CheckCircle2 size={16} strokeWidth={1.8} aria-hidden="true" />
        {successMessage}
      </span>
    {/if}

    <IconButton
      label="Refresh diff"
      variant="secondary"
      size="sm"
      onclick={onRefresh}
      title="Refresh diff"
    >
      <RefreshCw size={17} strokeWidth={1.8} aria-hidden="true" />
    </IconButton>

    <Button
      size="sm"
      onclick={openPromptDialog}
      disabled={!canSend}
      title={!hasComments ? 'Add comments before sending' : isAgentBusy ? `Agent is currently ${agentStatus}` : 'Review and send feedback to agent'}
    >
      <Send size={17} strokeWidth={1.8} aria-hidden="true" />
      {`Send feedback (${inlineCount + prCommentCount})`}
    </Button>
  </div>
</div>

{#if showPromptDialog}
  <Modal
    onClose={cancelPromptDialog}
    onKeydown={handlePromptKeydown}
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
          aria-keyshortcuts={isMac ? 'Meta+Enter' : 'Control+Enter'}
          disabled={isAgentBusy || !promptDraft.trim()}
          title={isAgentBusy ? `Agent is currently ${agentStatus}` : undefined}
        >
          <Send size={17} strokeWidth={1.8} aria-hidden="true" />
          Send to agent
          <kbd aria-hidden="true" class="ml-1 whitespace-nowrap text-[11px]">{isMac ? '⌘↵' : 'Ctrl+Enter'}</kbd>
        </Button>
      </div>
    </div>
  </Modal>
{/if}
