<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import type { Snippet } from 'svelte'

  interface Props {
    pluginId: string
    pluginName: string
    children?: Snippet
    onDisable?: () => void
    errorMessage?: string | null
  }

  let { pluginId, pluginName, children, onDisable, errorMessage = null }: Props = $props()
</script>

{#if errorMessage}
  <div class="rounded-[var(--of-radius-container)] border border-error/20 bg-error/10 p-4" role="alert" data-plugin-id={pluginId}>
    <p class="text-sm font-medium text-error">Plugin Error: {pluginName}</p>
    <p class="mt-1 text-xs text-error/70">{errorMessage}</p>
    {#if onDisable}
      <Button variant="danger" size="xs" class="mt-2" onclick={onDisable}>
        Disable Plugin
      </Button>
    {/if}
  </div>
{:else if children}
  {@render children()}
{/if}
