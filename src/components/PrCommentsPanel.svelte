<script lang="ts">
  import type { PrComment } from '../lib/types'
  import { addressSelectedPrComments } from '../lib/ipc'

  export let ticketId: string
  export let comments: PrComment[] = []

  let selectedIds: Set<number> = new Set()
  let isSubmitting = false

  function toggleComment(id: number) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id)
    } else {
      selectedIds.add(id)
    }
    selectedIds = selectedIds
  }

  function unaddressedComments(all: PrComment[]): PrComment[] {
    return all.filter(c => c.addressed === 0)
  }

  async function handleAddress() {
    if (selectedIds.size === 0) return
    isSubmitting = true
    try {
      await addressSelectedPrComments(ticketId, Array.from(selectedIds))
      selectedIds = new Set()
    } catch (e) {
      console.error('Failed to address comments:', e)
    } finally {
      isSubmitting = false
    }
  }

  $: pending = unaddressedComments(comments)
</script>

<div class="pr-comments">
  {#if pending.length === 0}
    <div class="empty">No unaddressed comments</div>
  {:else}
    <div class="comment-list">
      {#each pending as comment (comment.id)}
        <label class="comment-item">
          <input
            type="checkbox"
            checked={selectedIds.has(comment.id)}
            on:change={() => toggleComment(comment.id)}
          />
          <div class="comment-content">
            <div class="comment-header">
              <span class="comment-author">@{comment.author}</span>
              {#if comment.file_path}
                <span class="comment-location">
                  {comment.file_path}{#if comment.line_number}:{comment.line_number}{/if}
                </span>
              {/if}
            </div>
            <div class="comment-body">{comment.body}</div>
          </div>
        </label>
      {/each}
    </div>
    <div class="actions">
      <button class="btn btn-address" on:click={handleAddress} disabled={isSubmitting || selectedIds.size === 0}>
        Address Selected ({selectedIds.size})
      </button>
    </div>
  {/if}
</div>

<style>
  .pr-comments {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .empty {
    color: var(--text-secondary);
    text-align: center;
    padding: 40px;
    font-size: 0.8rem;
  }

  .comment-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
  }

  .comment-item {
    display: flex;
    gap: 10px;
    padding: 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .comment-item:hover {
    border-color: var(--accent);
  }

  .comment-item input[type="checkbox"] {
    margin-top: 2px;
    flex-shrink: 0;
    accent-color: var(--accent);
  }

  .comment-content {
    flex: 1;
    min-width: 0;
  }

  .comment-header {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 4px;
    flex-wrap: wrap;
  }

  .comment-author {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent);
  }

  .comment-location {
    font-size: 0.7rem;
    color: var(--text-secondary);
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  }

  .comment-body {
    font-size: 0.8rem;
    color: var(--text-primary);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .actions {
    padding: 10px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  .btn {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-address {
    background: var(--accent);
    color: var(--bg-primary);
    width: 100%;
  }
</style>
