<script lang="ts">
  import type { PrComment } from '../../../lib/types'
  import MarkdownContent from '../content/MarkdownContent.svelte'

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
</script>

<div class="flex flex-col gap-2">
  {#each comments as comment (comment.id)}
    <article class={density === 'compact'
      ? 'rounded-xl bg-base-200/50 border border-base-300/40 p-3 flex flex-col gap-1.5'
      : 'rounded-md border border-base-300/70 bg-base-100 p-2.5 flex flex-col gap-1.5'} aria-label={`Comment by ${comment.author}`}>
      <div class="flex items-center gap-1.5 text-[0.7rem] text-base-content/50">
        <span class="font-semibold text-base-content/80">{comment.author}</span>
      </div>
      {#if showLocation && comment.file_path}
        <!-- Path on its own row, truncating (as a flex child so overflow-hidden/ellipsis apply) so a long path can never grow the row and push controls out of view. -->
        <div class="flex items-center min-w-0">
          <span
            class="font-mono text-[0.7rem] text-base-content/50 bg-base-200 rounded px-1.5 py-0.5 overflow-hidden text-ellipsis whitespace-nowrap max-w-full"
          >{comment.file_path}{comment.line_number ? `:${comment.line_number}` : ''}</span>
        </div>
      {/if}
      <div class={density === 'compact'
        ? 'text-xs text-base-content/70 leading-relaxed [&_.markdown-body]:text-xs [&_.markdown-body_pre]:text-[10px] [&_.markdown-body_code]:text-[10px] [&_.markdown-body_p]:m-0'
        : 'text-xs text-base-content/75 leading-relaxed break-words [&_.markdown-body]:text-xs [&_.markdown-body_pre]:text-[10px] [&_.markdown-body_code]:text-[10px] [&_.markdown-body_p]:my-1'}>
        <MarkdownContent content={comment.body} imageBaseUrl={imageBaseUrlForComment(comment)} />
      </div>
      {#if showMarkAddressed && onMarkAddressed}
        <!-- Mark-addressed on its own row (self-start) so it stays fully visible/clickable regardless of path length. -->
        <button
          class="btn btn-ghost btn-xs text-success text-[0.65rem] h-auto min-h-0 py-0.5 self-start"
          onclick={() => void onMarkAddressed(comment.id)}
        >
          ✓ Mark addressed
        </button>
      {/if}
    </article>
  {/each}
</div>
