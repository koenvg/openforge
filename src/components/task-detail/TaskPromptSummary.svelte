<script lang="ts">
  import type { Task } from '../../lib/types'
  import MarkdownContent from '../shared/content/MarkdownContent.svelte'

  interface Props {
    task: Task
  }

  let { task }: Props = $props()

  const HANDOFF_PREVIEW_LENGTH = 112
  const PROMPT_PREVIEW_LENGTH = 148

  let handoffExpanded = $state(false)
  let promptExpanded = $state(false)
  let previousTaskId: string | null = null

  let handoffNotes = $derived(task.summary ? task.summary.replace(/\\n/g, '\n') : '')
  let handoffHasOverflow = $derived(handoffNotes.length > HANDOFF_PREVIEW_LENGTH)
  let visibleHandoffNotes = $derived(handoffExpanded || !handoffHasOverflow
    ? handoffNotes
    : `${handoffNotes.slice(0, HANDOFF_PREVIEW_LENGTH).trimEnd()}…`)

  let promptHasOverflow = $derived(task.initial_prompt.length > PROMPT_PREVIEW_LENGTH)
  let visiblePrompt = $derived(promptExpanded || !promptHasOverflow
    ? task.initial_prompt
    : `${task.initial_prompt.slice(0, PROMPT_PREVIEW_LENGTH).trimEnd()}…`)

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

<section class="rounded-lg border border-base-300/70 bg-base-100 overflow-hidden" aria-label="Documents">
  <h3 class="m-0 px-3 py-2 text-sm font-semibold text-base-content border-b border-base-300/70">Documents</h3>

  <section class="px-3 py-2 border-b border-base-300/70" aria-label="Handoff Notes">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <h4 class="m-0 text-sm font-semibold text-base-content">Handoff Notes</h4>
        {#if handoffNotes}
          <div id={handoffContentId} class="mt-1 text-xs text-base-content/65 leading-relaxed break-words [&_.markdown-body]:text-xs [&_.markdown-body_pre]:text-[10px] [&_.markdown-body_code]:text-[10px] [&_.markdown-body_p]:my-1">
            <MarkdownContent content={visibleHandoffNotes} />
          </div>
        {:else}
          <div id={handoffContentId} class="mt-1 text-xs text-base-content/45">No handoff notes yet</div>
        {/if}
      </div>
      {#if handoffHasOverflow}
        <button
          type="button"
          class="btn btn-outline btn-xs focus-visible:ring-2 focus-visible:ring-primary rounded"
          aria-expanded={handoffExpanded}
          aria-controls={handoffContentId}
          onclick={() => { handoffExpanded = !handoffExpanded }}
        >
          {handoffExpanded ? 'Collapse Handoff Notes' : 'Expand Handoff Notes'}
        </button>
      {/if}
    </div>
  </section>

  <section class="px-3 py-2" aria-label="Initial Prompt">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <h4 class="m-0 text-sm font-semibold text-base-content">Initial Prompt</h4>
        <div id={promptContentId} class="mt-1 text-xs text-base-content/65 leading-relaxed whitespace-pre-wrap break-words">{visiblePrompt}</div>
      </div>
      {#if promptHasOverflow}
        <button
          type="button"
          class="btn btn-outline btn-xs focus-visible:ring-2 focus-visible:ring-primary rounded"
          aria-expanded={promptExpanded}
          aria-controls={promptContentId}
          onclick={() => { promptExpanded = !promptExpanded }}
        >
          {promptExpanded ? 'Collapse Initial Prompt' : 'Expand Initial Prompt'}
        </button>
      {/if}
    </div>
  </section>
</section>
