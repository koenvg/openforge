<script lang="ts">
  import type { OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  let { context }: { context: OpenForgeContextSnapshot } = $props()
</script>

<section aria-label="Catalog plugin settings" class="rounded-lg border border-of-border bg-of-surface p-4 text-of-text">
  <h3 class="m-0 text-base font-semibold">Catalog settings contribution</h3>
  <p class="mt-2 text-sm">Provided by {context.pluginId}</p>
</section>
