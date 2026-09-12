<script lang="ts">
  import SearchPalette from './SearchPalette.svelte'
  let { onSelect = () => {}, onClose = () => {}, loading = false, alternate = false }: {
    alternate?: boolean
    onSelect?: (item: string) => void
    onClose?: () => void
    loading?: boolean
  } = $props()
  let query = $state('')
  let selectedIndex = $state(0)
  const entries = ['Alpha', 'Beta', 'Gamma']
  let items = $derived(entries.filter(item => item.toLowerCase().includes(query.toLowerCase())))
</script>

{#snippet confirmation()}<button>Confirm</button>{/snippet}

<SearchPalette
  {items} {query} {selectedIndex} {loading}
  onQueryChange={(value) => { query = value; selectedIndex = 0 }}
  onSelectedIndexChange={(value) => { selectedIndex = value }}
  {onSelect} {onClose} getKey={(item) => item}
  ariaLabel="Test palette" listboxLabel="Results" placeholder="Find a result..."
  groupLabel={(_item, index) => index === 0 ? 'Suggestions' : null}
  alternateContent={alternate ? confirmation : undefined}
  alternateInitialFocus="button"
  onKeydown={(event) => alternate && event.key === 'Escape'}
  actionLabel="select"
>
  {#snippet item(entry)}{entry}{/snippet}
  {#snippet emptyContent()}No matching results{/snippet}
  {#snippet loadingContent()}Loading results{/snippet}
</SearchPalette>
