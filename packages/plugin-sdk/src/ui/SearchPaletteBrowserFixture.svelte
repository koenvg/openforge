<script lang="ts">
  import SearchPalette from '@openforge-app/plugin-sdk/ui/SearchPalette.svelte'
  let open = $state(false)
  let query = $state('')
  let selectedIndex = $state(0)
  let confirming = $state(false)
  let selections = $state(0)
  const entries = Array.from({ length: 30 }, (_, index) => `Project ${index + 1}`)
  let items = $derived(entries.filter(entry => entry.toLowerCase().includes(query.toLowerCase())))
</script>

<button onclick={() => { open = true }}>Open palette</button>
<output aria-label="Selections">{selections}</output>
{#snippet confirmation()}
  <div style="padding: var(--of-space6)">
    <h2>Confirm selection?</h2>
    <button onclick={() => { confirming = false }}>Cancel</button>
    <button data-confirm onclick={() => { selections += 1; open = false; confirming = false }}>Confirm</button>
  </div>
{/snippet}
{#if open}
  <SearchPalette
    {items} {query} {selectedIndex} getKey={(entry) => entry}
    onQueryChange={(value) => { query = value; selectedIndex = 0 }}
    onSelectedIndexChange={(value) => { selectedIndex = value }}
    onSelect={() => { confirming = true }} onClose={() => { open = false }}
    ariaLabel="Projects" listboxLabel="Projects" placeholder="Search projects..."
    actionLabel={confirming ? 'confirm' : 'select'} cancelLabel={confirming ? 'cancel' : 'close'}
    trailingKey="Ctrl+N/P"
    groupLabel={(_entry, index) => index === 0 ? 'Projects' : null}
    alternateContent={confirming ? confirmation : undefined} alternateInitialFocus="[data-confirm]"
    onKeydown={(event) => {
      if (confirming && event.key === 'Escape') { confirming = false; return true }
      return false
    }}
  >
    {#snippet leading()}<span>▣</span>{/snippet}
    {#snippet item(entry)}<div>{entry}</div><div class="description">/workspace/a-long-project-path/that-should-not-overflow-the-dialog</div>{/snippet}
    {#snippet trailing()}Project{/snippet}
    {#snippet emptyContent()}No projects match{/snippet}
  </SearchPalette>
{/if}

<style>
  .description { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--of-text-secondary); }
</style>
