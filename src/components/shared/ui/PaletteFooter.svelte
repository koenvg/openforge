<script lang="ts">
  interface Props {
    actionLabel: string
    cancelLabel?: string
    trailingKey?: string
    trailingLabel?: string
  }

  let { actionLabel, cancelLabel = 'close', trailingKey, trailingLabel = 'navigate' }: Props = $props()
</script>

<div class="flex items-center gap-4 px-3 py-1.5 border-t border-base-300 bg-base-300/30">
  <span class="text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">↑↓</kbd> navigate</span>
  <span class="text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">Enter</kbd> {actionLabel}</span>
  <span class="text-[10px] text-base-content/40"><kbd class="kbd kbd-xs">Esc</kbd> {cancelLabel}</span>
  {#if trailingKey}
    <span class="text-[10px] text-base-content/40 ml-auto"><kbd class="kbd kbd-xs">{trailingKey}</kbd> {trailingLabel}</span>
  {/if}
</div>
