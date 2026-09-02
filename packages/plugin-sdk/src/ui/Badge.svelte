<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    children: Snippet
    variant?: BadgeVariant
  }

  let {
    children,
    variant = 'neutral',
    class: className,
    ...attributes
  }: Props = $props()
</script>

<span {...attributes} class={className} data-variant={variant}>
  {@render children()}
</span>

<style>
  span {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    min-height: var(--of-control-height-compact);
    padding: 0 var(--of-space2);
    border: var(--of-border-width) solid var(--of-status-neutral);
    border-radius: var(--of-radius-round);
    background: var(--of-status-neutral-subtle);
    color: var(--of-on-status-neutral);
    font-family: var(--of-font-sans);
    font-size: var(--of-text-xs);
    font-weight: var(--of-weight-medium);
    line-height: var(--of-line-height-xs);
  }

  span[data-variant='info'] {
    border-color: var(--of-info);
    background: var(--of-info-subtle);
    color: var(--of-info);
  }

  span[data-variant='success'] {
    border-color: var(--of-success);
    background: var(--of-success-subtle);
    color: var(--of-success);
  }

  span[data-variant='warning'] {
    border-color: var(--of-warning);
    background: var(--of-warning-subtle);
    color: var(--of-warning);
  }

  span[data-variant='danger'] {
    border-color: var(--of-danger);
    background: var(--of-danger-subtle);
    color: var(--of-danger);
  }
</style>
