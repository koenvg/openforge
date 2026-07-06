<script lang="ts">
  import type { Snippet } from 'svelte'

  interface StubProps {
    files?: Array<{ filename: string }>
    pendingComments?: Array<{ path: string; line: number; side: string; body: string }>
    onPendingCommentsChange?: (comments: Array<{ path: string; line: number; side: string; body: string }>) => void
    footer?: Snippet
    [key: string]: unknown
  }

  // Svelte 5 runes mode silently ignores props we don't destructure, so the
  // remaining forwarded props (existingComments, agentComments, callbacks, …)
  // need no explicit rest capture here.
  let {
    files = [],
    pendingComments = [],
    onPendingCommentsChange,
    footer,
  }: StubProps = $props()

  // Exposed so WalkthroughTab's `bind:this` instance calls never throw in tests.
  export function scrollToFile(_filename: string) {}
  export function focusDiff() {}
</script>

<div data-testid="diff-viewer-stub" data-file-count={files.length} data-pending-count={pendingComments.length}>
  {#each files as f}
    <span data-diff-file>{f.filename}</span>
  {/each}
  <button
    type="button"
    data-testid="stub-add-pending"
    onclick={() => onPendingCommentsChange?.([...pendingComments, { path: 'stub.ts', line: 1, side: 'RIGHT', body: 'stub comment' }])}
  >stub add pending</button>
  {#if footer}
    {@render footer()}
  {/if}
</div>
