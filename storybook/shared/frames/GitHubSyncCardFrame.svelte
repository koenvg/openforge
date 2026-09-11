<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children }: { children: Snippet } = $props()
</script>

<div class="min-h-screen bg-base-200 p-6 text-base-content">
  <div class="mx-auto w-full max-w-2xl">
    {@render children()}
  </div>
</div>
