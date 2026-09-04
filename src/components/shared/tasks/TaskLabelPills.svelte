<script lang="ts">
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import type { TaskLabel } from '../../../lib/types'

  interface Props {
    labels: TaskLabel[]
    max?: number
  }

  let { labels, max = 999 }: Props = $props()

  let visibleLabels = $derived(labels.slice(0, max))
  let hiddenCount = $derived(Math.max(0, labels.length - visibleLabels.length))
</script>

{#if labels.length > 0}
  <div class="flex flex-wrap gap-1" aria-label="Task labels">
    {#each visibleLabels as label (label.id)}
      <Badge variant="info" class="max-w-full truncate">{label.name}</Badge>
    {/each}
    {#if hiddenCount > 0}
      <Badge>+{hiddenCount}</Badge>
    {/if}
  </div>
{/if}
