<script lang="ts">
  import PaletteListbox from './PaletteListbox.svelte'
  let { items = ['Alpha', 'Beta', 'Gamma'], visible = true, loading = false, wrap = false, onSelect = () => {}, onCancel }: {
    items?: string[]
    visible?: boolean
    loading?: boolean
    wrap?: boolean
    onSelect?: (item: string) => void
    onCancel?: () => void
  } = $props()
  let selectedIndex = $state(0)
  let listbox: { handleKeydown: (event: KeyboardEvent) => boolean } | undefined = $state()
</script>

<PaletteListbox bind:this={listbox} {items} {selectedIndex} {visible} {loading} {wrap} {onSelect} {onCancel}
  onSelectedIndexChange={(index) => { selectedIndex = index }} getKey={(entry) => entry} listboxLabel="Suggestions" maxHeight="100px">
  {#snippet input(listboxId, activeDescendantId)}
    <textarea aria-label="Prompt" role="combobox" aria-expanded={visible} aria-controls={visible ? listboxId : undefined}
      aria-activedescendant={activeDescendantId} onkeydown={(event) => listbox?.handleKeydown(event)}></textarea>
  {/snippet}
  {#snippet item(entry)}{entry}{/snippet}
  {#snippet emptyContent()}No suggestions{/snippet}
  {#snippet loadingContent()}Loading suggestions{/snippet}
</PaletteListbox>
