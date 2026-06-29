<script lang="ts">
  import type { Task } from '../../lib/types'
  import { parseTaskPrompt } from '../../lib/taskPrompt'
  import MarkdownContent from '../shared/content/MarkdownContent.svelte'

  interface Props {
    task: Task
    onEditPrompt?: () => void
  }

  let { task, onEditPrompt }: Props = $props()

  // The prompt can only be edited before it has been injected into a session.
  let canEditPrompt = $derived(task.status === 'backlog' && !!onEditPrompt)

  const HANDOFF_PREVIEW_LENGTH = 112

  let handoffExpanded = $state(false)
  // The initial prompt is collapsed by default; its text is revealed on demand.
  let promptExpanded = $state(false)
  let previousTaskId: string | null = null

  let handoffNotes = $derived(task.summary ? task.summary.replace(/\\n/g, '\n') : '')
  let handoffHasOverflow = $derived(handoffNotes.length > HANDOFF_PREVIEW_LENGTH)
  let visibleHandoffNotes = $derived(handoffExpanded || !handoffHasOverflow
    ? handoffNotes
    : `${handoffNotes.slice(0, HANDOFF_PREVIEW_LENGTH).trimEnd()}…`)

  let initialPromptText = $derived(parseTaskPrompt(task.initial_prompt).text)

  let handoffContentId = $derived(`handoff-notes-${task.id}`)
  let promptContentId = $derived(`initial-prompt-${task.id}`)

  $effect(() => {
    if (task.id !== previousTaskId) {
      previousTaskId = task.id
      handoffExpanded = false
      promptExpanded = false
    }
  })
</script>

<section data-task-info-card="handoff-notes" data-card-sizing="natural" class="rounded-lg border border-base-300/70 bg-base-100 overflow-hidden shrink-0" aria-label="Handoff Notes">
  <h3 class="m-0 px-3 py-2 text-sm font-semibold text-base-content border-b border-base-300/70">Handoff Notes</h3>
  <div class="px-3 py-2 flex flex-col gap-2">
    {#if handoffNotes}
      <div
        id={handoffContentId}
        role="region"
        aria-label="Handoff Notes content"
        class="text-xs text-base-content/65 leading-relaxed break-words [&_.markdown-body]:text-xs [&_.markdown-body_pre]:text-[10px] [&_.markdown-body_code]:text-[10px] [&_.markdown-body_p]:my-1"
      >
        <MarkdownContent content={visibleHandoffNotes} />
      </div>
    {:else}
      <div id={handoffContentId} role="region" aria-label="Handoff Notes content" class="text-xs text-base-content/45">No handoff notes yet</div>
    {/if}
    {#if handoffHasOverflow}
      <div role="group" aria-label="Handoff Notes actions" class="flex justify-start">
        <button
          type="button"
          class="btn btn-outline btn-xs focus-visible:ring-2 focus-visible:ring-primary rounded"
          aria-expanded={handoffExpanded}
          aria-controls={handoffContentId}
          onclick={() => { handoffExpanded = !handoffExpanded }}
        >
          {handoffExpanded ? 'Show less Handoff Notes' : 'Show full Handoff Notes'}
        </button>
      </div>
    {/if}
  </div>
</section>

<section data-task-info-card="initial-prompt" data-card-sizing="natural" class="rounded-lg border border-base-300/70 bg-base-100 overflow-hidden shrink-0" aria-label="Initial Prompt">
  <div class="flex items-center gap-1.5 px-3 py-2 border-b border-base-300/70">
    <h3 class="m-0 text-sm font-semibold text-base-content">Initial Prompt</h3>
    {#if canEditPrompt}
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square text-base-content/50 hover:text-base-content"
        aria-label="Edit prompt"
        onclick={() => onEditPrompt?.()}
      >✎</button>
    {/if}
  </div>
  <div class="px-3 py-2 flex flex-col gap-2">
    {#if promptExpanded}
      <div id={promptContentId} role="region" aria-label="Initial Prompt content" class="text-xs text-base-content/65 leading-relaxed whitespace-pre-wrap break-words">{initialPromptText}</div>
    {/if}
    <div role="group" aria-label="Initial Prompt actions" class="flex justify-start">
      <button
        type="button"
        class="btn btn-outline btn-xs focus-visible:ring-2 focus-visible:ring-primary rounded"
        aria-expanded={promptExpanded}
        aria-controls={promptContentId}
        onclick={() => { promptExpanded = !promptExpanded }}
      >
        {promptExpanded ? 'Hide Initial Prompt' : 'Show Initial Prompt'}
      </button>
    </div>
  </div>
</section>
