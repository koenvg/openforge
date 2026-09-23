<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    subtitle?: string | null
    surface?: 'default' | 'subtle'
    headingLevel?: 'h1' | 'h2'
    actions?: Snippet
  }

  let {
    title,
    subtitle = null,
    surface = 'default',
    headingLevel = 'h1',
    actions,
  }: Props = $props()
</script>
<header class="of-page-header" data-surface={surface}>
  <div class="of-page-header-copy">
    <svelte:element this={headingLevel} class="of-page-header-title">{title}</svelte:element>
    {#if subtitle}
      <p class="of-page-header-subtitle">{subtitle}</p>
    {/if}
  </div>
  {#if actions}
    <div class="of-page-header-actions">{@render actions()}</div>
  {/if}
</header>

<style>
  header {
    box-sizing: border-box; display: flex; min-height: calc(var(--of-control-height-compact) + var(--of-space7)); flex-shrink: 0; flex-wrap: wrap;
    align-items: center; justify-content: space-between; column-gap: var(--of-space6); row-gap: var(--of-space4);
    border-bottom: var(--of-border-width) solid var(--of-border); background: var(--of-surface);
    padding: var(--of-space4) var(--of-space6);
  }
  header[data-surface='subtle'] { background: var(--of-surface-subtle); }
  .of-page-header-copy { min-width: 0; }
  .of-page-header-title { display: block; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--of-text); font-size: var(--of-text-lg); font-weight: 600; line-height: 1.25rem; letter-spacing: -0.01em; }
  .of-page-header-subtitle { margin: var(--of-space1) 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: color-mix(in oklab, var(--of-text) 60%, transparent); font-size: 13px; line-height: 1.25rem; }
  .of-page-header-actions { flex-shrink: 0; }
  @media (min-width: 640px) { header { padding-inline: var(--of-space7); } }
</style>
