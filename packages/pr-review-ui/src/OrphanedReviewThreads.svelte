<script lang="ts">
  import { TriangleAlert } from '@lucide/svelte'
  import type { ReviewThreadStatus } from '@openforge-app/plugin-sdk'
  import InlineReviewThread from './InlineReviewThread.svelte'
  import type { OrphanedReviewThread } from './reviewThreadAnchors'

  interface Props {
    threads: OrphanedReviewThread[]
    onReplyToThread?: (threadId: string, body: string) => void
    onSetThreadStatus?: (threadId: string, status: ReviewThreadStatus) => void
    onMarkThreadSeen?: (threadId: string) => void
    onOpenUrl?: (url: string) => void | Promise<void>
  }

  let { threads, onReplyToThread, onSetThreadStatus, onMarkThreadSeen, onOpenUrl }: Props = $props()

  const REASON_LABELS = {
    'file-not-in-diff': 'File is not in this diff',
    'line-not-in-diff': 'Line is not in this diff',
  } as const
</script>

{#if threads.length > 0}
  <section
    aria-label="Threads not in this diff"
    class="max-h-64 shrink-0 overflow-y-auto border-b border-of-border bg-of-surface-subtle px-4 py-2"
  >
    <div class="flex items-center gap-2 text-sm text-of-text/80">
      <TriangleAlert size={16} strokeWidth={1.8} aria-hidden="true" />
      <span>
        {threads.length === 1
          ? '1 thread is not in this diff'
          : `${threads.length} threads are not in this diff`}
      </span>
    </div>
    {#each threads as entry (entry.thread.id)}
      <div class="my-1.5 rounded-[var(--of-radius-container)] border border-of-border border-l-4 border-l-of-warning bg-of-surface px-4 py-2.5 text-[0.8rem]">
        <div class="mb-1.5 flex flex-wrap items-center gap-2 text-[0.7rem] text-of-text/60">
          <span class="font-mono">{entry.thread.anchor.filePath}:{entry.thread.anchor.line}</span>
          <span>{REASON_LABELS[entry.reason]}</span>
        </div>
        <InlineReviewThread
          comment={{ type: 'thread', thread: entry.thread }}
          {onReplyToThread}
          {onSetThreadStatus}
          {onMarkThreadSeen}
          {onOpenUrl}
        />
      </div>
    {/each}
  </section>
{/if}
