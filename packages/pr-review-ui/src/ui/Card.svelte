<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    onclick?: (e: MouseEvent) => void
    onmouseenter?: (e: MouseEvent) => void
    onmouseleave?: (e: MouseEvent) => void
    selected?: boolean
    featured?: boolean
    class?: string
    children: Snippet
  }

  let { onclick, onmouseenter, onmouseleave, selected = false, featured = false, class: className = '', children }: Props = $props()

  let baseClasses = 'w-full text-left bg-of-surface border rounded-[var(--of-radius-container)] cursor-pointer transition-all'

  let stateClasses = $derived.by(() => {
    if (selected) return 'selected border-2 border-of-accent bg-of-accent/10'
    if (featured) return 'border-of-border shadow-sm'
    return 'border-of-border/50 hover:border-of-accent/50 hover:shadow-sm'
  })
</script>

<button
  class="{baseClasses} {stateClasses} {className}"
  {onclick}
  {onmouseenter}
  {onmouseleave}
>
  {@render children()}
</button>
