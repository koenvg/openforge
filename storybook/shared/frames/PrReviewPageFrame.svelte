<script lang="ts">
  import type { Snippet } from 'svelte'
  let { children }: { children: Snippet } = $props()
</script>

<main class="h-screen min-h-0 bg-of-surface text-of-text">
  {@render children()}
</main>
