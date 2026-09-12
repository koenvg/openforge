<script lang="ts">
  import type { Snippet } from 'svelte'
  let { children }: { children: Snippet } = $props()
</script>

<div class="h-screen min-h-0 min-w-0 overflow-auto bg-of-surface text-of-text">
  {@render children()}
</div>
