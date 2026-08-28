<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    header: Snippet
    children: Snippet
    class?: string
  }

  let { header, children, class: className = '' }: Props = $props()
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden bg-base-100 text-base-content {className}">
  <div class="shrink-0">
    {@render header()}
  </div>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    {@render children()}
  </div>
</div>
