<script lang="ts">
  import type { Snippet } from 'svelte'
  import Alert from './Alert.svelte'
  import Badge from './Badge.svelte'
  import Button from './Button.svelte'
  import LoadingIndicator from './LoadingIndicator.svelte'

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
  <div class="view-state" role="status" aria-live="polite">
    <LoadingIndicator decorative style="color: var(--of-accent)" />
    <span>{loadingLabel}</span>
  </div>
{:else if error !== null}
  <div class="error-host">
    <Alert class="view-state" role="alert" aria-live="assertive">
      <Badge variant="danger" class="issue-badge">Issue</Badge>
      <h3>{errorTitle}</h3>
      {#if error}
        <p class="error-message">{error}</p>
      {/if}
      {#if errorActions}
        <div class="actions">{@render errorActions()}</div>
      {:else if onRetry}
        <Button class="retry" size="sm" type="button" onclick={handleRetry} disabled={retryDisabled}>{retryLabel}</Button>
      {/if}
    </Alert>
  </div>
{:else if empty}
  <div class="view-state" role="status" aria-live="polite">
    <h3>{emptyTitle}</h3>
    {#if emptyDescription}
      <p>{emptyDescription}</p>
    {/if}
    {#if emptyActions}
      <div class="actions">{@render emptyActions()}</div>
    {/if}
  </div>
{:else}
  {@render children?.()}
{/if}

<style>
  .error-host { display: contents; }
  .view-state, .error-host :global(.view-state) {
    box-sizing: border-box;
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 0;
    gap: .75rem;
    padding: 1.5rem;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: color-mix(in oklab, var(--of-text) 70%, transparent);
    font-family: var(--of-font-sans);
    font-size: .875rem;
    line-height: 1.25rem;
    text-align: center;
    overflow-wrap: normal;
  }
  h3 { margin: 0; font-size: 1.25rem; font-weight: 600; line-height: 1.75rem; color: var(--of-text); }
  p { margin: 0; max-width: 28rem; }
  .error-message { overflow-wrap: break-word; min-width: 0; max-width: min(100%, 28rem); }
  .actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: .5rem; padding-top: .25rem; }
  /* Retain the existing Issue marker's size and filled paint, not Badge's defaults. */
  .error-host :global(.issue-badge) {
    box-sizing: border-box;
    min-height: 0;
    height: calc(var(--of-control-height-compact) * .875);
    padding: 0 .703125rem;
    font-size: 1rem;
    line-height: 1.428571;
    font-weight: 400;
    background: var(--of-danger);
    color: var(--of-on-danger);
  }
  .error-host :global(.view-state .retry) { padding-inline: .75rem; font-size: .75rem; font-weight: 600; line-height: 1.428571; }
</style>
