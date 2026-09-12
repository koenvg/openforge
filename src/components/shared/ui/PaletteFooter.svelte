<script lang="ts">
  interface Props {
    actionLabel: string
    cancelLabel?: string
    trailingKey?: string
    trailingLabel?: string
  }

  let { actionLabel, cancelLabel = 'close', trailingKey, trailingLabel = 'navigate' }: Props = $props()
</script>

<div class="flex items-center gap-4 px-3 py-1.5 border-t border-of-border bg-of-border/30">
  <span class="text-[10px] text-of-text/40"><kbd class="of-key-hint of-key-hint-xs">↑↓</kbd> navigate</span>
  <span class="text-[10px] text-of-text/40"><kbd class="of-key-hint of-key-hint-xs">Enter</kbd> {actionLabel}</span>
  <span class="text-[10px] text-of-text/40"><kbd class="of-key-hint of-key-hint-xs">Esc</kbd> {cancelLabel}</span>
  {#if trailingKey}
    <span class="text-[10px] text-of-text/40 ml-auto"><kbd class="of-key-hint of-key-hint-xs">{trailingKey}</kbd> {trailingLabel}</span>
  {/if}
</div>
