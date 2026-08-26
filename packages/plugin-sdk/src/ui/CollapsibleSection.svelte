<script lang="ts">
  import type { Snippet } from 'svelte'
  import { collapsedSections, isSectionCollapsed, toggleSection } from '../collapsibleSectionState'

  interface Props {
    // Stable, global key used to persist the collapsed/expanded state. Plugins must
    // build this with `pluginSectionKey(pluginId, key)` so two plugins cannot collide.
    sectionKey: string
    title: string
    // aria-label for the section landmark (defaults to the title).
    label?: string
    // data-task-info-card value (defaults to the section key).
    cardId?: string
    ariaLive?: 'polite' | 'off'
    // A 14px glyph identifying the section, drawn between the disclosure caret and the
    // title. Keep it decorative: the host hides it from assistive tech so it cannot
    // pollute the toggle's accessible name.
    icon?: Snippet
    // Optional per-section controls (refresh, edit, counts). Rendered as a sibling of
    // the toggle button — never nested inside it — so nested <button>s stay valid.
    actions?: Snippet
    children: Snippet
  }

  let { sectionKey, title, label, cardId, ariaLive, icon, actions, children }: Props = $props()

  let collapsed = $derived(isSectionCollapsed($collapsedSections, sectionKey))
  let contentId = $derived(`info-section-${sectionKey}`)
</script>

<!-- `--section-inset` is the distance from the card edge to the caret. Hosts override it
     per surface (the task inspector pushes it out to 1.5rem); the header and the body
     both read it so they can never drift apart. `--section-caret-column` is the caret
     plus the gap after it, so body content lines up with the icon and title rather than
     starting under the caret. Keep it equal to the caret's `w-3` plus the header `gap-2`. -->
<section
  data-task-info-card={cardId ?? sectionKey}
  data-card-sizing="natural"
  class="rounded-lg border border-base-300/70 bg-base-100 overflow-hidden shrink-0 [--section-inset:0.75rem] [--section-caret-column:1.25rem]"
  aria-label={label ?? title}
  aria-live={ariaLive}
>
  <div class="flex items-stretch {collapsed ? '' : 'border-b border-base-300/70'}">
    <h3 class="m-0 min-w-0 flex-1">
      <button
        type="button"
        class="flex w-full items-center gap-2 px-[var(--section-inset)] py-2 text-left text-sm font-semibold text-base-content hover:bg-base-200/40 focus-visible:ring-2 focus-visible:ring-primary rounded"
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onclick={() => toggleSection(sectionKey)}
      >
        <!-- Fixed-width caret column so every section title starts at the same x,
             including the single-row cards that render a blank column instead. -->
        <span
          class="w-3 shrink-0 text-center text-[0.7rem] leading-none text-base-content/40 transition-transform duration-150 {collapsed ? '-rotate-90' : ''}"
          aria-hidden="true"
        >▾</span>
        {#if icon}
          <span class="flex shrink-0 items-center text-base-content/50" aria-hidden="true">{@render icon()}</span>
        {/if}
        <span class="truncate">{title}</span>
      </button>
    </h3>
    {#if actions}
      <div class="flex shrink-0 items-center gap-2 pr-2">
        {@render actions()}
      </div>
    {/if}
  </div>

  {#if !collapsed}
    <div
      id={contentId}
      class="pl-[calc(var(--section-inset)_+_var(--section-caret-column))] pr-[var(--section-inset)]"
    >
      {@render children()}
    </div>
  {/if}
</section>
