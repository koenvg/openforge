<script lang="ts">
  import type { TaskDetail } from '../../lib/types'
  import { parseTaskPrompt } from '../../lib/taskPrompt'
  import MarkdownContent from '../shared/adapters/MarkdownContent.svelte'
  import CollapsibleSection from '@openforge-app/plugin-sdk/ui/CollapsibleSection.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import MessageSquareQuote from '@lucide/svelte/icons/message-square-quote'

  interface Props {
    task: TaskDetail
    onEditPrompt?: () => void
  }

  let { task, onEditPrompt }: Props = $props()

  // The prompt can only be edited before it has been injected into a session.
  let canEditPrompt = $derived(task.status === 'backlog' && !!onEditPrompt)

  let initialPromptText = $derived(parseTaskPrompt(task.prompt).text)
  let promptContentId = $derived(`initial-prompt-${task.id}`)
</script>

<CollapsibleSection sectionKey="initial-prompt" title="Initial Prompt" cardId="initial-prompt">
  {#snippet icon()}<MessageSquareQuote size={14} />{/snippet}
  {#snippet actions()}
    {#if canEditPrompt}
      <IconButton
        label="Edit prompt"
        size="xs"
        type="button"
        onclick={() => onEditPrompt?.()}
      >✎</IconButton>
    {/if}
  {/snippet}
  <div class="py-2 flex flex-col gap-2">
    <div
      id={promptContentId}
      role="region"
      aria-label="Initial Prompt content"
      class="text-xs text-base-content/65 leading-relaxed break-words [&_.markdown-body]:text-xs [&_.markdown-body_pre]:text-[10px] [&_.markdown-body_code]:text-[10px] [&_.markdown-body_p]:my-1"
    >
      <MarkdownContent content={initialPromptText} />
    </div>
  </div>
</CollapsibleSection>
