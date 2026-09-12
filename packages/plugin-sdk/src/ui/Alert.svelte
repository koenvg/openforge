<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet
    variant?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  }

  let { children, variant = 'neutral', ...attributes }: Props = $props()
</script>

<div {...attributes} data-variant={variant}>
  {@render children()}
</div>

<style>
  div {
    box-sizing: border-box;
    display: grid;
    grid-auto-flow: column;
    grid-template-columns: auto;
    align-items: center;
    gap: 1rem;
    padding: .75rem 1rem;
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-container);
    background: var(--of-surface-subtle);
    color: var(--of-text);
    font-family: var(--of-font-sans);
    font-size: .875rem;
    line-height: 1.25rem;
    overflow-wrap: anywhere;
  }
  div[data-variant='info'] { border-color: var(--of-info); background: var(--of-info); color: var(--of-on-info); }
  div[data-variant='success'] { border-color: var(--of-success); background: var(--of-success); color: var(--of-on-success); }
  div[data-variant='warning'] { border-color: var(--of-warning); background: var(--of-warning); color: var(--of-on-warning); }
  div[data-variant='danger'] { border-color: var(--of-danger); background: var(--of-danger); color: var(--of-on-danger); }
</style>
