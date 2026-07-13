<script lang="ts">
  import type { Snippet } from 'svelte'
  import { infoPanelSectionCollapse, isInfoPanelSectionCollapsed, toggleInfoPanelSection } from '../../../lib/infoPanelSectionState'

  interface Props {
    // Stable, global key used to persist the collapsed/expanded state.
    sectionKey: string
    title: string
    // aria-label for the section landmark (defaults to the title).
    label?: string
    // data-task-info-card value (defaults to the section key).
    cardId?: string
    ariaLive?: 'polite' | 'off'
    // Optional per-section controls (refresh, edit, counts). Rendered as a sibling of
    // the toggle button — never nested inside it — so nested <button>s stay valid.
    actions?: Snippet
    children: Snippet
  }

  let { sectionKey, title, label, cardId, ariaLive, actions, children }: Props = $props()

  let collapsed = $derived(isInfoPanelSectionCollapsed($infoPanelSectionCollapse, sectionKey))
  let contentId = $derived(`info-section-${sectionKey}`)
</script>

<section
  data-task-info-card={cardId ?? sectionKey}
  data-card-sizing="natural"
  class="rounded-lg border border-base-300/70 bg-base-100 overflow-hidden shrink-0"
  aria-label={label ?? title}
  aria-live={ariaLive}
>
  <div class="flex items-stretch {collapsed ? '' : 'border-b border-base-300/70'}">
    <h3 class="m-0 min-w-0 flex-1">
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-base-content hover:bg-base-200/40 focus-visible:ring-2 focus-visible:ring-primary rounded"
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onclick={() => toggleInfoPanelSection(sectionKey)}
      >
        <span
          class="shrink-0 text-[0.7rem] leading-none text-base-content/40 transition-transform duration-150 {collapsed ? '-rotate-90' : ''}"
          aria-hidden="true"
        >▾</span>
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
    <div id={contentId}>
      {@render children()}
    </div>
  {/if}
</section>
