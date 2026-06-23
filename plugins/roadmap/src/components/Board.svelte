<script lang="ts">
  import type { BoardCard, BoardColumn } from '../lib/board'
  import Card from './Card.svelte'

  interface Props {
    columns: BoardColumn[]
    repo: string
    onCardClick: (card: BoardCard) => void
    onOpenUrl: (url: string) => void
    onCopyLink: (issueNumber: number) => void
  }

  let { columns, repo, onCardClick, onOpenUrl, onCopyLink }: Props = $props()

  const HEX6 = /^[0-9a-fA-F]{6}$/

  // GitHub label colors are data; apply a soft theme-aware tint from the API value
  // only. color-mix blends the hex into a daisyUI semantic base color.
  function columnTint(color: string | null): string {
    if (!color || !HEX6.test(color)) return ''
    return `background-color: color-mix(in srgb, #${color} 12%, var(--color-base-200)); border-color: color-mix(in srgb, #${color} 30%, var(--color-base-300));`
  }

  function swatchStyle(color: string | null): string {
    if (!color || !HEX6.test(color)) return ''
    return `background-color: #${color};`
  }
</script>

<div class="flex flex-wrap gap-3 p-4 items-start overflow-y-auto h-full content-start">
  {#each columns as column (column.label || 'other')}
    <div
      class="flex flex-col rounded-box border border-base-300 bg-base-200 min-w-[260px] flex-1 basis-[260px] max-h-full"
      style={columnTint(column.color)}
    >
      <div class="flex items-center gap-2 px-3 py-2 border-b border-base-300/60">
        {#if column.color && !column.isOther}
          <span class="w-2.5 h-2.5 rounded-full shrink-0" style={swatchStyle(column.color)}></span>
        {/if}
        <span class="text-sm font-semibold text-base-content truncate">{column.title}</span>
        <span class="badge badge-ghost badge-sm ml-auto shrink-0">{column.cards.length}</span>
      </div>
      <div class="flex flex-col gap-2 p-2 overflow-y-auto">
        {#each column.cards as card (card.issueNumber)}
          <Card
            {card}
            {repo}
            onOpen={() => onCardClick(card)}
            {onOpenUrl}
            {onCopyLink}
          />
        {/each}
        {#if column.cards.length === 0}
          <p class="text-xs text-base-content/40 text-center py-4 m-0">No issues</p>
        {/if}
      </div>
    </div>
  {/each}
</div>
