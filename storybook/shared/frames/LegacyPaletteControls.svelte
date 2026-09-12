<script lang="ts">
  import PaletteModal from '../../../src/components/shell/PaletteModal.svelte'
  import PaletteInput from '../../../src/components/shared/ui/PaletteInput.svelte'
  import PaletteListbox from '../../../src/components/shared/ui/PaletteListbox.svelte'
  import PaletteFooter from '../../../src/components/shared/ui/PaletteFooter.svelte'

  let query = $state('')
  let selectedIndex = $state(0)
  let listbox: { handleKeydown: (event: KeyboardEvent) => boolean } | null = $state(null)
  const entries = ['Projects', 'Commands', 'Files']
  let items = $derived(entries.filter(item => item.toLowerCase().includes(query.toLowerCase())))
</script>

<PaletteModal ariaLabel="Legacy palette controls" onClose={() => {}} onKeydown={(event) => listbox?.handleKeydown(event) ?? false}>
  <PaletteListbox
    bind:this={listbox} {items} {selectedIndex}
    onSelectedIndexChange={(index) => { selectedIndex = index }}
    onSelect={() => {}} getKey={(item) => item}
    idPrefix="legacy-catalog" listboxLabel="Legacy entries"
    listClass="max-h-[300px] overflow-y-auto"
  >
    {#snippet input(listboxId, activeDescendantId)}
      <PaletteInput {listboxId} {activeDescendantId} bind:value={query} placeholder="Filter legacy entries..." onInput={() => { selectedIndex = 0 }} />
    {/snippet}
    {#snippet item(entry)}<span class="block px-4 py-2 text-sm">{entry}</span>{/snippet}
    {#snippet emptyContent()}<p class="p-4 text-sm">No legacy entries</p>{/snippet}
  </PaletteListbox>
  <PaletteFooter actionLabel="select" trailingKey="Ctrl+N/P" />
</PaletteModal>
