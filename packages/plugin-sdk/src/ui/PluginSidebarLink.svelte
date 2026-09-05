<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    accessibleName: string
    active: boolean
    collapsed: boolean
    onActivate: () => void
    leading?: Snippet
    label?: Snippet
    trailing?: Snippet
    class?: string
  }

  let {
    accessibleName,
    active,
    collapsed,
    onActivate,
    leading,
    label,
    trailing,
    class: className,
  }: Props = $props()

</script>

<button
  type="button"
  class={['of-plugin-sidebar-link', className]}
  data-active={active}
  data-collapsed={collapsed}
  title={collapsed ? accessibleName : undefined}
  aria-label={accessibleName}
  aria-current={active ? 'page' : undefined}
  onclick={onActivate}
>
  {#if leading}
    <span class="of-plugin-sidebar-link-leading">{@render leading()}</span>
  {/if}
  {#if !collapsed}
    {#if label}<span class="of-plugin-sidebar-link-label">{@render label()}</span>{/if}
    {#if trailing}<span class="of-plugin-sidebar-link-trailing">{@render trailing()}</span>{/if}
  {/if}
</button>

<style>
  button {
    position: relative;
    display: flex;
    align-items: center;
    width: calc(100% - (var(--of-space2) * 2));
    min-height: var(--of-control-height-touch);
    margin: 0 var(--of-space2);
    padding: var(--of-space2) var(--of-space3);
    gap: var(--of-space3);
    border: var(--of-border-width) solid transparent;
    border-radius: var(--of-radius-round);
    background: transparent;
    color: var(--of-text-muted);
    font-family: var(--of-font-sans);
    cursor: pointer;
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard),
      color var(--of-duration-fast) var(--of-ease-standard);
  }

  button:hover {
    background: var(--of-control-hover);
    color: var(--of-text);
  }

  button:active {
    background: var(--of-control-pressed);
  }

  button[data-active='true'] {
    border-color: var(--of-border-interactive);
    background: var(--of-accent-subtle);
    color: var(--of-on-accent-subtle);
  }

  button[data-collapsed='true'] {
    justify-content: center;
    padding-inline: 0;
  }

  button:focus-visible {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  .of-plugin-sidebar-link-leading {
    position: relative;
    flex-shrink: 0;
  }

  .of-plugin-sidebar-link-label {
    min-width: 0;
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
  }

  .of-plugin-sidebar-link-trailing {
    flex-shrink: 0;
    margin-left: auto;
  }

  @media (prefers-reduced-motion: reduce) {
    button {
      transition: none;
    }
  }
</style>
