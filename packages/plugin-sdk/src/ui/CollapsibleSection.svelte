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

<!-- Hosts may override the section inset without changing the public interface. -->
<section
  data-task-info-card={cardId ?? sectionKey}
  data-card-sizing="natural"
  class="of-collapsible-section"
  aria-label={label ?? title}
  aria-live={ariaLive}
>
  <div class="section-header" class:expanded={!collapsed}>
    <h3>
      <button type="button" aria-expanded={!collapsed} aria-controls={contentId} onclick={() => toggleSection(sectionKey)}>
        <span class="caret" class:collapsed aria-hidden="true">▾</span>
        {#if icon}<span class="section-icon" aria-hidden="true">{@render icon()}</span>{/if}
        <span class="section-title">{title}</span>
      </button>
    </h3>
    {#if actions}<div class="section-actions">{@render actions()}</div>{/if}
  </div>
  {#if !collapsed}<div id={contentId} class="section-content">{@render children()}</div>{/if}
</section>

<style>
  section { --section-inset: .75rem; --section-caret-column: 1.25rem; flex-shrink: 0; overflow: hidden; border: var(--of-border-width) solid color-mix(in oklab, var(--of-border) 70%, transparent); border-radius: var(--of-radius-control); background: var(--of-surface); }
  .section-header { display: flex; align-items: stretch; }
  .section-header.expanded { border-bottom: var(--of-border-width) solid color-mix(in oklab, var(--of-border) 70%, transparent); }
  h3 { margin: 0; min-width: 0; flex: 1; }
  button { display: flex; width: 100%; align-items: center; gap: var(--of-space4); border: 0; border-radius: calc(var(--of-radius-control) / 2); background: transparent; padding: var(--of-space4) var(--section-inset); color: var(--of-text); text-align: left; font-size: var(--of-text-md); font-weight: 600; line-height: 1.25rem; cursor: pointer; }
  button:hover { background: color-mix(in oklab, var(--of-surface-subtle) 40%, transparent); }
  button:focus-visible { outline: var(--of-focus-width) solid var(--of-focus-ring); outline-offset: var(--of-space1); box-shadow: 0 0 0 2px var(--of-accent); }
  .caret { width: .75rem; flex-shrink: 0; text-align: center; color: color-mix(in oklab, var(--of-text) 40%, transparent); font-size: .7rem; line-height: 1; transition: transform 150ms; }
  .caret.collapsed { transform: rotate(-90deg); }
  .section-icon { display: flex; flex-shrink: 0; align-items: center; color: color-mix(in oklab, var(--of-text) 50%, transparent); }
  .section-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .section-actions { display: flex; flex-shrink: 0; align-items: center; gap: var(--of-space4); padding-right: var(--of-space4); }
  .section-content { padding-left: calc(var(--section-inset) + var(--section-caret-column)); padding-right: var(--section-inset); }
  @media (prefers-reduced-motion: reduce) { .caret { transition: none; } }
</style>
