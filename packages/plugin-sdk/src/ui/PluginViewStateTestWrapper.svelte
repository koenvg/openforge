<script lang="ts">
  import PluginViewState from './PluginViewState.svelte'

  interface Props {
    mode: 'content' | 'loading' | 'error' | 'empty'
    onRetry?: () => void
    retryDisabled?: boolean
  }

  let { mode, onRetry, retryDisabled = false }: Props = $props()
</script>

<PluginViewState
  loading={mode === 'loading'}
  loadingLabel="Loading plugin records…"
  error={mode === 'error' ? 'Network unavailable' : null}
  errorTitle="Unable to load plugin records"
  empty={mode === 'empty'}
  emptyTitle="No plugin records"
  emptyDescription="Records created by this plugin will appear here."
  retryLabel="Retry loading records"
  {onRetry}
  {retryDisabled}
>
  <article aria-label="Plugin records">
    <h2>Plugin record list</h2>
    <p>Record Alpha</p>
  </article>
</PluginViewState>
