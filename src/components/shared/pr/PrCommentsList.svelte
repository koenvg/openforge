<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Select from '@openforge-app/plugin-sdk/ui/Select.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Checkbox from '@openforge-app/plugin-sdk/ui/Checkbox.svelte'
  import type { PrComment } from '../../../lib/types'
  import { createCommentAddressing } from '../../../lib/commentAddressing.svelte'
  import { uniqueAuthors, filterByAuthor } from '../../../lib/prCommentLinks'
  import { openUrl } from '../../../lib/ipc'
  import { timeAgo } from '../../../lib/timeAgo'
  import MarkdownContent from '../adapters/MarkdownContent.svelte'
  import type { ResolvedMarkdownMedia } from '../../../lib/markdown'

  interface Props {
    comments: PrComment[]
    imageBaseUrlForComment?: (comment: PrComment) => string | null
    /** Exchange a GitHub upload URL for one this app can render (images and recordings). */
    resolveRemoteMedia?: (url: string) => Promise<ResolvedMarkdownMedia | null>
    onMarkAddressed?: (commentId: number) => void | Promise<void>
    showLocation?: boolean
    showMarkAddressed?: boolean
    density?: 'compact' | 'detail'
    /** Enable per-card selection checkboxes (review-tab "send to agent" flow). */
    selectable?: boolean
    /** Currently selected comment ids (only used when `selectable`). */
    selectedIds?: Set<number>
    /** Toggle selection for a comment (only used when `selectable`). */
    onToggleSelect?: (commentId: number) => void
    /** Build a link to the original comment on GitHub; return null for no link. */
    commentUrl?: (comment: PrComment) => string | null
    /** Called when a comment card is clicked (e.g. scroll the diff to its line). */
    onCommentClick?: (comment: PrComment) => void
    /** Show a control to filter comments by their author. */
    showAuthorFilter?: boolean
    /** Show a relative timestamp (e.g. "2h ago") for each comment. */
    showTimestamp?: boolean
    /**
     * Externally-managed mark-addressed state. When both are provided, the list
     * reflects the caller's addressing state (busy + error) and calls
     * `onMarkAddressed` directly instead of managing its own. Otherwise it uses
     * an internal addressing controller.
     */
    isAddressing?: (commentId: number) => boolean
    addressErrorFor?: (commentId: number) => string | null
  }

  let {
    comments,
    imageBaseUrlForComment = () => null,
    resolveRemoteMedia,
    onMarkAddressed,
    showLocation = false,
    showMarkAddressed = false,
    density = 'detail',
    selectable = false,
    selectedIds,
    onToggleSelect,
    commentUrl,
    onCommentClick,
    showAuthorFilter = false,
    showTimestamp = false,
    isAddressing,
    addressErrorFor,
  }: Props = $props()

  const commentAddressing = createCommentAddressing()

  let selectedAuthor = $state<string | null>(null)
  let authors = $derived(uniqueAuthors(comments))
  let displayedComments = $derived(filterByAuthor(comments, selectedAuthor))
  let useExternalAddressing = $derived(!!isAddressing && !!addressErrorFor)

  // If the filtered author no longer has any comments (e.g. their last comment was
  // marked addressed), fall back to showing everyone so the list never gets stuck
  // on an empty filtered view with no way out.
  $effect(() => {
    if (selectedAuthor !== null && !authors.includes(selectedAuthor)) {
      selectedAuthor = null
    }
  })

  function addressingBusy(id: number): boolean {
    return useExternalAddressing ? isAddressing!(id) : commentAddressing.isAddressing(id)
  }

  function addressingError(id: number): string | null {
    return useExternalAddressing ? addressErrorFor!(id) : commentAddressing.errorFor(id)
  }

  function handleMarkClick(id: number): void {
    if (useExternalAddressing) {
      void onMarkAddressed?.(id)
    } else {
      void commentAddressing.run(id, () => onMarkAddressed?.(id))
    }
  }

  function handleCardKeydown(event: KeyboardEvent, comment: PrComment): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onCommentClick?.(comment)
    }
  }

  let cardBaseClass = $derived(
    density === 'compact'
      ? 'rounded-[var(--of-radius-container)] bg-base-200/50 border border-base-300/40 p-3 flex items-start gap-2 min-w-0'
      : 'rounded-[var(--of-radius-container)] border border-base-300/70 bg-base-100 p-2.5 flex items-start gap-2 min-w-0'
  )
</script>

{#snippet cardBody(comment: PrComment)}
  {@const commentHref = commentUrl?.(comment) ?? null}
  {@const isSelected = selectedIds?.has(comment.id) ?? false}
  {#if selectable && comment.addressed === 0}
    <Checkbox
      size="xs"
      class="mt-0.5 shrink-0"
      checked={isSelected}
      onclick={(e) => e.stopPropagation()}
      onchange={() => onToggleSelect?.(comment.id)}
      aria-label={`Select comment by ${comment.author}`}
    />
  {/if}
  <div class="min-w-0 flex-1 flex flex-col gap-1.5">
    <div class={showMarkAddressed ? 'flex items-start gap-2 min-w-0' : 'flex flex-wrap items-center gap-1.5 text-[0.7rem] text-base-content/50 min-w-0'}>
      <div class={showMarkAddressed ? 'min-w-0 flex-1 flex flex-wrap items-center gap-1.5 text-[0.7rem] text-base-content/50' : 'contents'}>
        <span class={showMarkAddressed ? 'text-[0.65rem] font-semibold text-base-content/60 shrink-0' : 'font-semibold text-base-content/80'}>{comment.author}</span>
        {#if showLocation && comment.file_path}
          <span class="shrink-0">·</span>
          <span class="min-w-0 break-all" title={comment.file_path}>{comment.file_path}{comment.line_number ? `:${comment.line_number}` : ''}</span>
        {/if}
        {#if comment.addressed === 1}
          <Badge variant="success" class="shrink-0">Addressed</Badge>
        {/if}
        {#if comment.outdated}
          <Badge variant="warning" class="shrink-0">Outdated</Badge>
        {/if}
        {#if commentHref}
          <button
            class="text-[0.7rem] text-primary hover:underline shrink-0"
            onclick={(e) => { e.stopPropagation(); void openUrl(commentHref) }}
          >GitHub ↗</button>
        {/if}
        {#if showTimestamp}
          <span class="text-[0.65rem] text-base-content/40 ml-auto shrink-0">{timeAgo(comment.created_at * 1000)}</span>
        {/if}
      </div>
      {#if showMarkAddressed && onMarkAddressed && comment.addressed === 0}
        {@const addressError = addressingError(comment.id)}
        {@const busy = addressingBusy(comment.id)}
        <Button
          variant="ghost" size="xs" class="text-success text-[0.65rem] shrink-0"
          disabled={busy}
          onclick={(e) => { e.stopPropagation(); handleMarkClick(comment.id) }}
        >
          {#if busy}
            Marking…
          {:else if addressError}
            Retry mark addressed
          {:else}
            ✓ Mark addressed
          {/if}
        </Button>
      {/if}
    </div>
    <div class={density === 'compact'
      ? 'text-xs text-base-content/70 leading-relaxed [&_.markdown-body]:text-xs [&_.markdown-body_pre]:text-[10px] [&_.markdown-body_code]:text-[10px] [&_.markdown-body_p]:m-0'
      : 'text-xs text-base-content/75 leading-relaxed break-words [&_.markdown-body]:text-xs [&_.markdown-body_pre]:text-[10px] [&_.markdown-body_code]:text-[10px] [&_.markdown-body_p]:my-1'}>
      <MarkdownContent content={comment.body} imageBaseUrl={imageBaseUrlForComment(comment)} {resolveRemoteMedia} />
    </div>
    {#if addressingError(comment.id)}
      <p class="m-0 text-xs text-error" role="alert">{addressingError(comment.id)}</p>
    {/if}
  </div>
{/snippet}

<div class="flex flex-col gap-2 min-w-0">
  {#if showAuthorFilter && authors.length > 1}
    <Select
      label="Filter comments by reviewer" hideLabel
      value={selectedAuthor ?? ''}
      options={[{ value: '', label: `All reviewers (${comments.length})` }, ...authors.map(author => ({ value: author, label: author }))]}
      onValueChange={(value) => { selectedAuthor = value || null }}
    />
  {/if}
  {#each displayedComments as comment (comment.id)}
    {#if onCommentClick}
      <div
        class="{cardBaseClass} cursor-pointer hover:border-primary/50 transition-colors{comment.addressed === 1 ? ' opacity-60' : ''}"
        role="button"
        tabindex="0"
        aria-label={`Comment by ${comment.author}`}
        onclick={() => onCommentClick?.(comment)}
        onkeydown={(e) => handleCardKeydown(e, comment)}
      >
        {@render cardBody(comment)}
      </div>
    {:else}
      <article
        class="{cardBaseClass}{comment.addressed === 1 ? ' opacity-60' : ''}"
        aria-label={`Comment by ${comment.author}`}
      >
        {@render cardBody(comment)}
      </article>
    {/if}
  {/each}
</div>
