<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children }: { children: Snippet } = $props()
</script>

<div class="min-h-screen bg-of-surface-subtle p-6 text-of-text">
  <div class="mx-auto w-full max-w-2xl">
    {@render children()}
  </div>
</div>
