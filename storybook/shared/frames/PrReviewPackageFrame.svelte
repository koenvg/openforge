<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children }: { children: Snippet } = $props()
</script>

<div class="min-h-screen bg-of-surface-subtle p-6 text-of-text" data-testid="pr-review-story-frame">
  <div class="mx-auto h-[calc(100vh-3rem)] w-full max-w-[900px] overflow-hidden">
    {@render children()}
  </div>
</div>
