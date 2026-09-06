<script lang="ts">
  import type {
    AiThread,
    PrWalkthroughStep,
  } from '@openforge-app/plugin-sdk/domain'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  import Textarea from '@openforge-app/plugin-sdk/ui/Textarea.svelte'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'

  interface Props {
    activeStep: PrWalkthroughStep | null
    visible: boolean
    aiThreads: AiThread[]
    onOpenUrl: (url: string) => void | Promise<void>
    onAskAgentStep?: (stepId: string, body: string) => void
    onReplyToThread?: (threadId: string, body: string) => void
  }

  let {
    activeStep,
    visible,
    aiThreads,
    onOpenUrl,
    onAskAgentStep,
    onReplyToThread,
  }: Props = $props()

  let questionOpen = $state(false)
  let questionText = $state('')
  let replyDrafts = $state<Record<string, string>>({})
  let activeThreads = $derived.by(() => {
    if (!activeStep) return []
    return aiThreads.filter(
      thread => thread.anchor.type === 'step' && thread.anchor.step_id === activeStep?.id,
    )
  })

  function submitQuestion(): void {
    const text = questionText.trim()
    if (!text || !activeStep) return
    onAskAgentStep?.(activeStep.id, text)
    questionText = ''
    questionOpen = false
  }

  function cancelQuestion(): void {
    questionOpen = false
    questionText = ''
  }

  function submitReply(threadId: string): void {
    const text = (replyDrafts[threadId] ?? '').trim()
    if (!text) return
    onReplyToThread?.(threadId, text)
    const next = { ...replyDrafts }
    delete next[threadId]
    replyDrafts = next
  }

</script>

{#if visible && activeStep && onAskAgentStep}
  <div class="flex flex-col gap-2">
    {#each activeThreads as thread}
      <Panel class="border-l-4 border-l-info text-[0.8rem]">
        <div class="flex items-center gap-2 mb-1">
          <Badge variant="info">Ask the AI</Badge>
          {#if thread.status === 'pending'}
            <span class="loading loading-spinner loading-xs"></span>
            <span class="text-base-content/50 text-[0.7rem]">thinking…</span>
          {/if}
          {#if thread.status === 'error'}
            <span class="text-error text-[0.7rem]">failed — send again</span>
          {/if}
        </div>
        {#each thread.messages as message}
          <div class="mb-1">
            <span class="text-base-content/50 text-[0.7rem] mr-1 {message.role === 'user' ? 'font-semibold' : ''}">{message.role === 'ai' ? 'AI author' : 'You'}</span>
            <span class="[&_p]:m-0 [&_p]:inline"><MarkdownContent content={message.body} {onOpenUrl} /></span>
          </div>
        {/each}
        {#if thread.status === 'answered'}
          <div class="mt-1 flex items-end gap-2">
            <div class="min-w-0 flex-1">
              <TextField
                label="Reply to the AI author"
                placeholder="Reply…"
                value={replyDrafts[thread.id] ?? ''}
                onValueChange={(value) => {
                  replyDrafts = { ...replyDrafts, [thread.id]: value }
                }}
                onkeydown={(event: KeyboardEvent) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submitReply(thread.id)
                  }
                }}
              />
            </div>
            <Button type="button" size="xs" onclick={() => submitReply(thread.id)}>Reply</Button>
          </div>
        {/if}
      </Panel>
    {/each}

    {#if questionOpen}
      <div>
        <Textarea
          label="Ask the AI author about this step"
          placeholder="Ask the AI author about this step… (Cmd/Ctrl+Enter to send)"
          rows={2}
          class="w-full resize-y text-[0.8rem]"
          bind:value={questionText}
          onkeydown={(event: KeyboardEvent) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submitQuestion()
            }
          }}
        />
        <div class="flex justify-end gap-2 mt-1">
          <Button type="button" variant="ghost" size="xs" onclick={cancelQuestion}>Cancel</Button>
          <Button type="button" size="xs" onclick={submitQuestion}>Ask</Button>
        </div>
      </div>
    {:else}
      <Button type="button" variant="ghost" size="xs" class="self-start text-info" onclick={() => { questionOpen = true }}>+ Ask about this step</Button>
    {/if}
  </div>
{/if}
