<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  type BadgeVariant =
    | 'neutral'
    | 'info'
    | 'success'
    | 'warning'
    | 'danger'
    | 'status-neutral'
    | 'status-running'
    | 'status-warning'
    | 'status-danger'
    | 'status-success'

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

  span[data-variant='status-neutral'] {
    border-color: var(--of-status-neutral);
    background: var(--of-status-neutral-subtle);
    color: var(--of-on-status-neutral);
  }

  span[data-variant='status-running'] {
    border-color: var(--of-status-running);
    background: var(--of-status-running-subtle);
    color: var(--of-on-status-running);
  }

  span[data-variant='status-warning'] {
    border-color: var(--of-status-warning);
    background: var(--of-status-warning-subtle);
    color: var(--of-on-status-warning);
  }

  span[data-variant='status-danger'] {
    border-color: var(--of-status-danger);
    background: var(--of-status-danger-subtle);
    color: var(--of-on-status-danger);
  }

  span[data-variant='status-success'] {
    border-color: var(--of-status-success);
    background: var(--of-status-success-subtle);
    color: var(--of-on-status-success);
  }
</style>
