<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import SearchPalette from '@openforge-app/plugin-sdk/ui/SearchPalette.svelte'
  import themeStylesheet from '../../../packages/plugin-sdk/src/ui/browser/search-palette-theme.css?url'

  let { variant = 'populated', onSelect = () => {}, onClose = () => {} }: {
    variant?: 'populated' | 'empty' | 'loading' | 'overflow' | 'grouped' | 'confirmation' | 'themed'
    onSelect?: (item: string) => void
    onClose?: () => void
  } = $props()
  let open = $state(true)
  let query = $state('')
  let selectedIndex = $state(0)
  const entries = ['Projects', 'Commands', 'Files']
  let items = $derived(variant === 'empty' ? [] : (variant === 'overflow'
    ? Array.from({ length: 24 }, (_, i) => `Catalog entry ${i + 1}: a long result label`)
    : entries).filter(item => item.toLowerCase().includes(query.toLowerCase())))
  function close() { open = false; onClose() }
  function reopen() { query = ''; selectedIndex = 0; open = true }
</script>

<svelte:head>
  {#if variant === 'themed'}<link rel="stylesheet" href={themeStylesheet} />{/if}
</svelte:head>

{#snippet confirmation()}
  <section style="padding: var(--of-space6)">
    <h2>Run the selected action?</h2>
    <Button onclick={close}>Confirm</Button>
  </section>
{/snippet}

{#if open}
  <SearchPalette
    ariaLabel="Catalog palette controls" onClose={close}
    {items} {selectedIndex} query={query}
    onSelectedIndexChange={(index) => { selectedIndex = index }}
    onQueryChange={(value) => { query = value; selectedIndex = 0 }}
    onSelect={(item) => { onSelect(item); close() }}
    getKey={(item) => item} listboxLabel="Catalog entries"
    loading={variant === 'loading'} placeholder="Filter catalog entries..."
    actionLabel={variant === 'confirmation' ? 'confirm' : 'select'} trailingKey="Ctrl+N/P"
    groupLabel={variant === 'grouped' ? (_item, index) => index === 0 ? 'Navigation' : index === 2 ? 'Workspace' : null : undefined}
    alternateContent={variant === 'confirmation' ? confirmation : undefined} alternateInitialFocus="button"
  >
    {#snippet item(entry)}{entry}{/snippet}
    {#snippet trailing()}Navigation{/snippet}
    {#snippet emptyContent()}No catalog entries{/snippet}
    {#snippet loadingContent()}Loading catalog entries...{/snippet}
  </SearchPalette>
{:else}
  <Button onclick={reopen}>Reopen controls</Button>
{/if}
