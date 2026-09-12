# SDK search palette

Import `SearchPalette` from `@openforge-app/plugin-sdk/ui/SearchPalette.svelte`. OpenForge uses this same dialog for command search, project switching, and task actions.

```svelte
<script lang="ts">
  import SearchPalette from '@openforge-app/plugin-sdk/ui/SearchPalette.svelte'

  let open = $state(true)
  let query = $state('')
  let selectedIndex = $state(0)
  const entries = [{ id: 'settings', label: 'Settings' }, { id: 'help', label: 'Help' }]
  let items = $derived(entries.filter(entry => entry.label.toLowerCase().includes(query.toLowerCase())))

  function select(entry: typeof entries[number]) {
    console.log(entry.id)
    open = false
  }
</script>

{#if open}
  <SearchPalette
    {items} {query} {selectedIndex}
    onQueryChange={(value) => { query = value; selectedIndex = 0 }}
    onSelectedIndexChange={(value) => { selectedIndex = value }}
    getKey={(entry) => entry.id} onSelect={select} onClose={() => { open = false }}
    ariaLabel="Plugin navigation" listboxLabel="Destinations"
    placeholder="Search destinations..." actionLabel="open"
  >
    {#snippet item(entry)}{entry.label}{/snippet}
    {#snippet emptyContent()}No destinations match{/snippet}
  </SearchPalette>
{/if}
```

## Caller responsibilities

The caller owns query state, loading, filtering, ordering, selection policy, and execution. Supply unique stable keys for the current results. Set `selectedIndex` to `-1` for no selection, or to the selected result's current index. Identity-based callers should derive the index from their selected key when results reorder.

`onQueryChange` and `onSelectedIndexChange` report input and navigation; update the corresponding props in those callbacks. `onSelect` does not close automatically. Unmount the palette when `onClose` requests dismissal or when your action should close it.

The palette owns search focus, dialog focus containment and return, Arrow Up/Down and Ctrl+J/N/K/P navigation, Enter activation, Escape dismissal, and scrolling the selected result into view. Loading and empty states do not activate stale results. It supplies result IDs and combobox/listbox attributes, so callers do not need to forward keyboard events.

## Content and footer

- `item` renders a result's main content. Its arguments are the result, index, and selected state. Keep this content non-interactive because the whole row is an option.
- Optional `leading` and `trailing` snippets receive the result. Leading content is decorative and hidden from assistive technology; put meaningful information in the main content or trailing text.
- `groupLabel` receives a result and index. Return a heading at the start of a group and `null` for subsequent rows. Headings are not selectable.
- `loading`, `loadingContent`, and `emptyContent` provide the list's announced state.
- `actionLabel` describes Enter. `cancelLabel` defaults to `close`. `trailingKey` adds an optional hint, with `trailingLabel` defaulting to `navigate`. Arrow navigation remains visible in the footer.
- `alternateContent` replaces search/results inside the same dialog. `alternateInitialFocus` is a selector scoped to that content. Supply `onKeydown` for alternate-mode behavior; returning `true` consumes the event before normal palette or dialog handling. Removing alternate content restores search focus. The caller still owns confirmation and execution.
- `testId` identifies the dialog layer when a test needs a specific backdrop.

## Theme customization

Existing themes require no new manifest tokens. Default palette colors, text, spacing, focus, and geometry use semantic `--of-*` variables. The palette defaults to an opaque theme surface without blur.

A selected plugin theme can include a CSS file through its existing theme `stylesheets` contribution. The theme stylesheet loader applies that file only while the theme is selected. Use the following optional component properties on `.of-search-palette`, the dialog layer:

| Property | Default |
| --- | --- |
| `--of-palette-background` | `var(--of-surface-raised)` |
| `--of-palette-border` | `var(--of-border-strong)` |
| `--of-palette-selection` | `var(--of-accent-subtle)` |
| `--of-palette-radius` | `var(--of-radius-overlay)` |
| `--of-palette-shadow` | `var(--of-shadow-overlay)` |
| `--of-palette-backdrop-filter` | `none` |

Example CSS for a light plugin theme:

```css
.of-search-palette {
  --of-palette-background: #f1f4f8;
  --of-palette-border: #7a8599;
  --of-palette-selection: #c9d5e8;
  --of-palette-radius: 22px;
  --of-palette-shadow: 0 16px 48px rgb(0 0 0 / 20%);
}

@supports (backdrop-filter: blur(12px)) {
  .of-search-palette {
    --of-palette-background: rgb(241 244 248 / 85%);
    --of-palette-backdrop-filter: blur(12px);
  }
}
```

Choose colors that retain contrast with your theme's text and focus tokens. The solid declaration is a fallback for browsers without backdrop filtering. Blur affects app content behind the dialog, not the operating-system desktop. No native window transparency is enabled.

Stable styling hooks also include `.of-search-palette-panel` and descendants with `data-palette-part="input"`, `"list"`, `"group"`, `"option"`, `"footer"`, or `"alternate"`. Selected options expose `data-selected` and `aria-selected="true"`. Do not depend on generated Svelte classes or private nesting. Prefer the CSS properties for panel paint and selection; use semantic theme tokens for text and focus.

## Examples and verification

The component catalog's `Components/Palette controls` stories cover grouped results, long lists, narrow viewports, loading, empty results, alternate content, and a theme override. Page stories retain the production command search, project-switching, and action workflows.

Browser tests check light/dark geometry and focus, plus switching to and away from a contributed theme through the real theme registry and stylesheet loader. Only delivery of the fixture's `plugin://` CSS asset is intercepted. Published contract checks compile a plugin that imports and renders the SDK palette.
