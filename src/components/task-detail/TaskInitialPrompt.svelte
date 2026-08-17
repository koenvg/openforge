<script lang="ts">
  import type { Task } from '../../lib/types'
  import { parseTaskPrompt } from '../../lib/taskPrompt'
  import MarkdownContent from '../shared/adapters/MarkdownContent.svelte'
  import CollapsibleInfoSection from '../shared/ui/CollapsibleInfoSection.svelte'

  interface Props {
    task: Task
    onEditPrompt?: () => void
  }

  let { task, onEditPrompt }: Props = $props()

  // The prompt can only be edited before it has been injected into a session.
  let canEditPrompt = $derived(task.status === 'backlog' && !!onEditPrompt)

  const INITIAL_PROMPT_PREVIEW_LINES = 3

  // The initial prompt shows a short preview by default; full text is revealed on demand.
  let promptExpanded = $state(false)
  let previousTaskId: string | null = null
  let initialPromptText = $derived(parseTaskPrompt(task.initial_prompt).text)
  let initialPromptPreview = $derived(initialPromptText.split('\n').slice(0, INITIAL_PROMPT_PREVIEW_LINES).join('\n'))
  let initialPromptHasOverflow = $derived(initialPromptText.split('\n').length > INITIAL_PROMPT_PREVIEW_LINES)
  let visibleInitialPrompt = $derived(promptExpanded || !initialPromptHasOverflow ? initialPromptText : initialPromptPreview)

  let promptContentId = $derived(`initial-prompt-${task.id}`)

  $effect(() => {
    if (task.id !== previousTaskId) {
      previousTaskId = task.id
      promptExpanded = false
    }
  })
</script>

<CollapsibleInfoSection sectionKey="initial-prompt" title="Initial Prompt" cardId="initial-prompt">
  {#snippet actions()}
    {#if canEditPrompt}
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square text-base-content/50 hover:text-base-content"
        aria-label="Edit prompt"
        onclick={() => onEditPrompt?.()}
      >✎</button>
    {/if}
  {/snippet}
  <div class="px-3 py-2 flex flex-col gap-2">
    <div
      id={promptContentId}
      role="region"
      aria-label="Initial Prompt content"
      class="text-xs text-base-content/65 leading-relaxed break-words [&_.markdown-body]:text-xs [&_.markdown-body_pre]:text-[10px] [&_.markdown-body_code]:text-[10px] [&_.markdown-body_p]:my-1"
    >
      <MarkdownContent content={visibleInitialPrompt} />
    </div>
    {#if initialPromptHasOverflow}
      <div role="group" aria-label="Initial Prompt actions" class="flex justify-start">
        <button
          type="button"
          class="btn btn-outline btn-xs focus-visible:ring-2 focus-visible:ring-primary rounded"
          aria-expanded={promptExpanded}
          aria-controls={promptContentId}
          onclick={() => { promptExpanded = !promptExpanded }}
        >
          {promptExpanded ? 'Show less Initial Prompt' : 'Show full Initial Prompt'}
        </button>
      </div>
    {/if}
  </div>
</CollapsibleInfoSection>
