<script lang="ts">
  import { ExternalLink, Copy } from '@lucide/svelte'
  import type { BoardCard } from '../lib/board'

  interface Props {
    card: BoardCard
    repo: string
    onOpen: () => void
    onOpenUrl: (url: string) => void
    onCopyLink: (issueNumber: number) => void
  }

  let { card, repo, onOpen, onOpenUrl, onCopyLink }: Props = $props()

  let issueUrl = $derived(`https://github.com/${repo}/issues/${card.issueNumber}`)

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="card card-compact bg-base-100 border border-base-300 shadow-sm hover:border-primary/50 transition-colors cursor-pointer"
  role="button"
  tabindex="0"
  onclick={onOpen}
  onkeydown={handleKeydown}
>
  <div class="card-body p-3 gap-2">
    <div class="flex items-start gap-2">
      <span class="text-sm font-medium text-base-content flex-1 min-w-0 break-words">{card.title}</span>
      {#if card.value !== null}
        <span class="badge badge-primary badge-sm shrink-0" title="Value">{card.value}</span>
      {/if}
    </div>
    <div class="flex items-center gap-1">
      <span class="text-xs text-base-content/40">#{card.issueNumber}</span>
      <div class="ml-auto flex items-center gap-1">
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          title="Open issue on GitHub"
          aria-label="Open issue on GitHub"
          onclick={(e) => { e.stopPropagation(); onOpenUrl(issueUrl) }}
        >
          <ExternalLink size={14} />
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          title="Copy issue link"
          aria-label="Copy issue link"
          onclick={(e) => { e.stopPropagation(); onCopyLink(card.issueNumber) }}
        >
          <Copy size={14} />
        </button>
      </div>
    </div>
  </div>
</div>
