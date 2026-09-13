<script lang="ts">
  import PaletteListbox from '@openforge-app/plugin-sdk/ui/PaletteListbox.svelte'
  let { mode = 'populated' }: { mode?: 'populated' | 'loading' | 'empty' | 'overflow' } = $props()
  let query = $state('')
  let selectedIndex = $state(0)
  let selected = $state('')
  let visible = $state(true)
  let listbox: { handleKeydown: (event: KeyboardEvent) => boolean } | undefined = $state()
  const entries = ['Review changes', 'Run tests', 'Explain selection']
  let items = $derived(mode === 'empty' ? [] : (mode === 'overflow'
    ? Array.from({ length: 30 }, (_, index) => `Suggestion ${index + 1}`) : entries)
    .filter(item => item.toLowerCase().includes(query.toLowerCase())))
</script>

<div class="frame">
  <label for="inline-prompt">Prompt completion</label>
  <PaletteListbox bind:this={listbox} {items} {selectedIndex} {visible} loading={mode === 'loading'} wrap={false}
    onSelectedIndexChange={(index) => { selectedIndex = index }} onCancel={() => { visible = false }}
    onSelect={(entry) => { selected = entry; query = entry; visible = false }} getKey={(entry) => entry}
    listboxLabel="Suggestions" maxHeight="220px" listClass="inline-suggestions">
    {#snippet input(listboxId, activeDescendantId)}
      <textarea id="inline-prompt" role="combobox" aria-autocomplete="list" aria-expanded={visible}
        aria-controls={visible ? listboxId : undefined} aria-activedescendant={activeDescendantId}
        value={query} placeholder="Write a prompt..."
        oninput={(event) => { query = event.currentTarget.value; selectedIndex = 0; visible = true }}
        onkeydown={(event) => listbox?.handleKeydown(event)}></textarea>
    {/snippet}
    {#snippet item(entry)}{entry}{/snippet}
    {#snippet emptyContent()}No suggestions{/snippet}
    {#snippet loadingContent()}Loading suggestions...{/snippet}
  </PaletteListbox>
  <output aria-label="Accepted suggestion">{selected}</output>
  <button onclick={() => { visible = true; query = ''; selectedIndex = 0 }}>Show suggestions</button>
</div>

<style>
  .frame { width: min(100%, 520px); padding: var(--of-space4); color: var(--of-text); }
  label { display: block; margin-bottom: var(--of-space2); }
  textarea { box-sizing: border-box; width: 100%; min-height: 80px; resize: vertical; border: 1px solid var(--of-border); border-radius: var(--of-radius-control); background: var(--of-surface); color: var(--of-text); padding: var(--of-space3); font: inherit; }
  textarea:focus-visible, button:focus-visible { outline: 2px solid var(--of-focus-ring); outline-offset: 2px; }
  :global(.inline-suggestions) { border: 1px solid var(--of-border); border-radius: var(--of-radius-control); background: var(--of-surface-raised); }
  output { display: block; min-height: 24px; }
  button { color: var(--of-text); background: var(--of-surface); border: 1px solid var(--of-border); padding: var(--of-space2); border-radius: var(--of-radius-control); }
</style>
