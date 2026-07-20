<script lang="ts">
  import type { PrComment } from '../../../lib/types'
  import { createCommentAddressing } from '../../../lib/commentAddressing.svelte'
  import MarkdownContent from '../adapters/MarkdownContent.svelte'

  interface Props {
    comments: PrComment[]
    imageBaseUrlForComment?: (comment: PrComment) => string | null
    onMarkAddressed?: (commentId: number) => void | Promise<void>
    showLocation?: boolean
    showMarkAddressed?: boolean
    density?: 'compact' | 'detail'
  }

  let {
    comments,
    imageBaseUrlForComment = () => null,
    onMarkAddressed,
    showLocation = false,
    showMarkAddressed = false,
    density = 'detail',
  }: Props = $props()

  const commentAddressing = createCommentAddressing()

  function handleMarkAddressed(commentId: number): Promise<boolean> {
    return commentAddressing.run(commentId, () => onMarkAddressed?.(commentId))
  }
</script>

<div class="flex flex-col gap-2 min-w-0">
  {#each comments as comment (comment.id)}
    <article class={density === 'compact'
      ? 'rounded-xl bg-base-200/50 border border-base-300/40 p-3 flex flex-col gap-1.5 min-w-0'
      : 'rounded-md border border-base-300/70 bg-base-100 p-2.5 flex flex-col gap-1.5 min-w-0'} aria-label={`Comment by ${comment.author}`}>
      <div class={showMarkAddressed ? 'flex items-start gap-2 min-w-0' : 'flex flex-wrap items-center gap-1.5 text-[0.7rem] text-base-content/50 min-w-0'}>
        <div class={showMarkAddressed ? 'min-w-0 flex-1 flex flex-wrap items-center gap-1.5 text-[0.7rem] text-base-content/50' : 'contents'}>
          <span class={showMarkAddressed ? 'text-[0.65rem] font-semibold text-base-content/60 shrink-0' : 'font-semibold text-base-content/80'}>{comment.author}</span>
          {#if showLocation && comment.file_path}
            <span class="shrink-0">·</span>
            <span class="min-w-0 break-all" title={comment.file_path}>{comment.file_path}{comment.line_number ? `:${comment.line_number}` : ''}</span>
          {/if}
        </div>
        {#if showMarkAddressed && onMarkAddressed}
          {@const addressError = commentAddressing.errorFor(comment.id)}
          {@const isAddressing = commentAddressing.isAddressing(comment.id)}
          <button
            class="btn btn-ghost btn-xs text-success text-[0.65rem] h-auto min-h-0 py-0.5 shrink-0"
            disabled={isAddressing}
            onclick={() => void handleMarkAddressed(comment.id)}
          >
            {#if isAddressing}
              Marking…
            {:else if addressError}
              Retry mark addressed
            {:else}
              ✓ Mark addressed
            {/if}
          </button>
        {/if}
      </div>
      <div class={density === 'compact'
        ? 'text-xs text-base-content/70 leading-relaxed [&_.markdown-body]:text-xs [&_.markdown-body_pre]:text-[10px] [&_.markdown-body_code]:text-[10px] [&_.markdown-body_p]:m-0'
        : 'text-xs text-base-content/75 leading-relaxed break-words [&_.markdown-body]:text-xs [&_.markdown-body_pre]:text-[10px] [&_.markdown-body_code]:text-[10px] [&_.markdown-body_p]:my-1'}>
        <MarkdownContent content={comment.body} imageBaseUrl={imageBaseUrlForComment(comment)} />
      </div>
      {#if commentAddressing.errorFor(comment.id)}
        <p class="m-0 text-xs text-error" role="alert">{commentAddressing.errorFor(comment.id)}</p>
      {/if}
    </article>
  {/each}
</div>
