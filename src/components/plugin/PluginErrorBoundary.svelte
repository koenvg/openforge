<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    pluginId: string
    pluginName: string
    children: Snippet
    onDisable?: () => void
  }

  let { pluginId, pluginName, children, onDisable }: Props = $props()

  let hasError = $state(false)
  let errorMessage = $state('')

  export function setError(message: string): void {
    hasError = true
    errorMessage = message
  }

  export function clearError(): void {
    hasError = false
    errorMessage = ''
  }
</script>

{#if hasError}
  <div class="rounded-lg border border-error/20 bg-error/10 p-4" role="alert" data-plugin-id={pluginId}>
    <p class="text-sm font-medium text-error">Plugin Error: {pluginName}</p>
    <p class="mt-1 text-xs text-error/70">{errorMessage}</p>
    {#if onDisable}
      <button class="btn btn-error btn-outline btn-xs mt-2" onclick={onDisable}>
        Disable Plugin
      </button>
    {/if}
  </div>
{:else}
  {@render children()}
{/if}
