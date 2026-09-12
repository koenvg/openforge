<script lang="ts">
  import LoadingIndicator from '@openforge-app/plugin-sdk/ui/LoadingIndicator.svelte'
  import Alert from '@openforge-app/plugin-sdk/ui/Alert.svelte'
  import Progress from '@openforge-app/plugin-sdk/ui/Progress.svelte'
  import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'

  let { themes }: { themes: { id: string; properties: Record<string, string> }[] } = $props()
  let themeId = $state(themes[0].id)
  let value = $state<number | undefined>(25)
  let max = $state(50)
  let loading = $state(false)
  let error = $state<string | null>('Network unavailable')
  let retryDisabled = $state(false)
  let retries = $state(0)
  let draft = $state('Keep this draft')
  let themeStyle = $derived(Object.entries(themes.find(theme => theme.id === themeId)!.properties).map(([key, value]) => `${key}:${value}`).join(';'))
</script>

<main style={themeStyle} data-theme={themeId}>
  <label for="theme">Theme</label>
  <select id="theme" bind:value={themeId}>{#each themes as theme}<option value={theme.id}>{theme.id}</option>{/each}</select>
  <label>Draft <input bind:value={draft} /></label>
  <section aria-label="Indicators" style="color:var(--of-accent)">
    {#each ['xs', 'sm', 'md', 'lg'] as const as size}
      <LoadingIndicator {size} aria-label={`Loading ${size}`} />
    {/each}
    <span id="loading-name">Loading files</span><LoadingIndicator aria-labelledby="loading-name" />
  </section>
  <section aria-label="Alerts">
    {#each ['neutral', 'info', 'success', 'warning', 'danger'] as const as variant}
      <Alert {variant} aria-label={`${variant} feedback`} role="group">Network unavailable</Alert>
    {/each}
    <Alert variant="danger" role="status" aria-live="polite" aria-label="Polite feedback">Retry scheduled</Alert>
    <Alert variant="success" role="alert" aria-label="Urgent feedback">Caller-owned urgency</Alert>
    <Alert class="plugin-owned" aria-label="Plugin owned" role="group">Plugin-owned CSS</Alert>
  </section>
  <section aria-label="Progress controls">
    <label for="download">Download</label><Progress id="download" {value} {max} />
    <button type="button" onclick={() => value = value === undefined ? 25 : undefined}>Toggle indeterminate</button>
    <button type="button" onclick={() => { value = 200; max = 50 }}>Overflow value</button>
    <button type="button" onclick={() => { value = -10; max = 0 }}>Invalid range</button>
    {#each ['neutral', 'primary', 'info', 'success', 'warning', 'danger'] as const as variant}
      <Progress {variant} value={30} max={100} aria-label={`${variant} progress`} />
    {/each}
  </section>
  <section aria-label="Plugin view" class="plugin-view">
    <PluginViewState {loading} {error} {retryDisabled} onRetry={() => { retries += 1; loading = true }}>
      <p>Plugin records ready</p>
    </PluginViewState>
  </section>
  <p aria-label="Retry count">{retries}</p>
  <button type="button" onclick={() => { loading = false; error = null }}>Finish loading</button>
  <button type="button" onclick={() => { loading = false; error = 'Network unavailable' }}>Fail loading</button>
  <label>Disable retry <input type="checkbox" bind:checked={retryDisabled} /></label>
</main>

<style>
  :global(body) { margin: 0; }
  main { font-family: var(--of-font-sans); color: var(--of-text); background: var(--of-surface); font-size: 16px; line-height: 24px; }
  section { margin-block: 16px; }
  .plugin-view { width: 320px; max-width: 100%; height: 300px; }
  main :global(.plugin-owned) { background: rgb(1, 2, 3); color: rgb(250, 251, 252); }
</style>
