<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  type PanelVariant = 'default' | 'subtle' | 'raised'
  type PanelPadding = 'default' | 'none'

  interface Props extends HTMLAttributes<HTMLElement> {
    children: Snippet
    header?: Snippet
    footer?: Snippet
    variant?: PanelVariant
    padding?: PanelPadding
  }

  let {
    children,
    header,
    footer,
    variant = 'default',
    padding = 'default',
    class: className,
    ...attributes
  }: Props = $props()
</script>

<section {...attributes} class={className} data-variant={variant} data-padding={padding}>
  {#if header}
    <div class="of-panel-header">{@render header()}</div>
  {/if}
  <div class="of-panel-body">{@render children()}</div>
  {#if footer}
    <div class="of-panel-footer">{@render footer()}</div>
  {/if}
</section>

<style>
  section {
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-container);
    background: var(--of-surface);
    color: var(--of-text);
    font-family: var(--of-font-sans);
  }

  section[data-variant='subtle'] {
    background: var(--of-surface-subtle);
  }

  section[data-variant='raised'] {
    border-color: var(--of-border-strong);
    background: var(--of-surface-raised);
    box-shadow: var(--of-shadow-raised);
  }

  .of-panel-header,
  .of-panel-body,
  .of-panel-footer {
    padding: var(--of-space4);
  }

  section[data-padding='none'] > .of-panel-body {
    padding: 0;
  }

  .of-panel-header {
    border-bottom: var(--of-border-width) solid var(--of-border);
  }

  .of-panel-footer {
    border-top: var(--of-border-width) solid var(--of-border);
  }
</style>
