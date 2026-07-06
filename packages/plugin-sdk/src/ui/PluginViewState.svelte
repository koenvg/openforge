<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    loading?: boolean
    loadingLabel?: string
    error?: string | null
    errorTitle?: string
    empty?: boolean
    emptyTitle?: string
    emptyDescription?: string | null
    retryLabel?: string
    retryDisabled?: boolean
    onRetry?: () => void
    errorActions?: Snippet
    emptyActions?: Snippet
    children?: Snippet
  }

  let {
    loading = false,
    loadingLabel = 'Loading…',
    error = null,
    errorTitle = 'Unable to load',
    empty = false,
    emptyTitle = 'Nothing to show',
    emptyDescription = null,
    retryLabel = 'Retry',
    retryDisabled = false,
    onRetry,
    errorActions,
    emptyActions,
    children,
  }: Props = $props()

  function handleRetry() {
    if (retryDisabled) return
    onRetry?.()
  }
</script>

{#if loading}
  <div class="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-base-content/70" role="status" aria-live="polite">
    <span class="loading loading-spinner loading-md text-primary" aria-label={loadingLabel}></span>
    <span>{loadingLabel}</span>
  </div>
{:else if error !== null}
  <div class="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-base-content/70" role="alert" aria-live="assertive">
    <div class="badge badge-error badge-lg">Issue</div>
    <h3 class="m-0 text-xl font-semibold text-base-content">{errorTitle}</h3>
    {#if error}
      <p class="m-0 max-w-md break-words text-base-content/70">{error}</p>
    {/if}
    {#if errorActions}
      <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
        {@render errorActions()}
      </div>
    {:else if onRetry}
      <button class="btn btn-primary btn-sm" type="button" onclick={handleRetry} disabled={retryDisabled}>{retryLabel}</button>
    {/if}
  </div>
{:else if empty}
  <div class="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-base-content/70" role="status" aria-live="polite">
    <h3 class="m-0 text-xl font-semibold text-base-content">{emptyTitle}</h3>
    {#if emptyDescription}
      <p class="m-0 max-w-md text-base-content/70">{emptyDescription}</p>
    {/if}
    {#if emptyActions}
      <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
        {@render emptyActions()}
      </div>
    {/if}
  </div>
{:else}
  {@render children?.()}
{/if}
