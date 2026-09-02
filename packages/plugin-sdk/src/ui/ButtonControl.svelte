<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  type ButtonControlVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  type ButtonControlSize = 'xs' | 'sm' | 'md' | 'lg'
  type ButtonControlKind = 'text' | 'icon'

  interface Props extends HTMLButtonAttributes {
    children: Snippet
    variant: ButtonControlVariant
    size: ButtonControlSize
    kind: ButtonControlKind
    onClick?: (event: MouseEvent) => void
  }

  let {
    children,
    variant,
    size,
    kind,
    class: className,
    disabled = false,
    onclick,
    onClick,
    ...attributes
  }: Props = $props()
</script>

<button
  {...attributes}
  class={className}
  data-variant={variant}
  data-size={size}
  data-control-kind={kind}
  {disabled}
  onclick={(event) => {
    if (!disabled) {
      onclick?.(event)
      onClick?.(event)
    }
  }}
>
  {@render children()}
</button>

<style>
  button {
    box-sizing: border-box;
    border: var(--of-border-width) solid transparent;
    border-radius: var(--of-radius-control);
    cursor: pointer;
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard),
      box-shadow var(--of-duration-fast) var(--of-ease-standard),
      color var(--of-duration-fast) var(--of-ease-standard);
  }

  button[data-control-kind='text'] {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--of-control-height);
    padding: 0 var(--of-space4);
    font-family: var(--of-font-sans);
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
    line-height: var(--of-line-height-sm);
  }

  button[data-control-kind='icon'] {
    display: inline-grid;
    place-content: center;
    width: var(--of-control-height);
    height: var(--of-control-height);
    padding: var(--of-space2);
  }

  button[data-variant='primary'] {
    border-color: var(--of-accent);
    background: var(--of-accent);
    color: var(--of-on-accent);
  }

  button[data-variant='primary']:hover:not(:disabled) {
    border-color: var(--of-accent-hover);
    background: var(--of-accent-hover);
    color: var(--of-on-accent);
  }

  button[data-variant='primary']:active:not(:disabled) {
    border-color: var(--of-accent-pressed);
    background: var(--of-accent-pressed);
    color: var(--of-on-accent);
  }

  button[data-variant='secondary'] {
    border-color: var(--of-border-interactive);
    background: var(--of-control);
    color: var(--of-control-text);
  }

  button[data-variant='outline'] {
    border-color: var(--of-border-interactive);
    background: transparent;
    color: var(--of-text);
  }

  button[data-variant='ghost'] {
    border-color: transparent;
    background: transparent;
    color: var(--of-text);
  }

  button[data-control-kind='icon'][data-variant='ghost'] {
    color: var(--of-icon);
  }

  button[data-variant='secondary']:hover:not(:disabled),
  button[data-variant='outline']:hover:not(:disabled),
  button[data-variant='ghost']:hover:not(:disabled) {
    background: var(--of-control-hover);
    color: var(--of-text);
  }

  button[data-variant='secondary']:active:not(:disabled),
  button[data-variant='outline']:active:not(:disabled),
  button[data-variant='ghost']:active:not(:disabled) {
    background: var(--of-control-pressed);
    color: var(--of-text);
  }

  button[data-variant='danger'] {
    border-color: var(--of-danger);
    background: var(--of-danger);
    color: var(--of-on-danger);
  }

  button[data-variant='danger']:hover:not(:disabled),
  button[data-variant='danger']:active:not(:disabled) {
    border-color: var(--of-status-danger);
    background: var(--of-status-danger);
    color: var(--of-on-danger);
  }

  button[data-control-kind='text'][data-size='xs'],
  button[data-control-kind='text'][data-size='sm'] {
    min-height: var(--of-control-height-compact);
    padding-inline: var(--of-space3);
    font-size: var(--of-text-xs);
    line-height: var(--of-line-height-xs);
  }

  button[data-control-kind='text'][data-size='lg'] {
    min-height: var(--of-control-height-touch);
    padding-inline: var(--of-space5);
    font-size: var(--of-text-md);
    line-height: var(--of-line-height-md);
  }

  button[data-control-kind='icon'][data-size='xs'],
  button[data-control-kind='icon'][data-size='sm'] {
    width: var(--of-control-height-compact);
    height: var(--of-control-height-compact);
    padding: var(--of-space1);
  }

  button[data-control-kind='icon'][data-size='lg'] {
    width: var(--of-control-height-touch);
    height: var(--of-control-height-touch);
    padding: var(--of-space3);
  }

  button:focus-visible {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  button:disabled {
    border-color: var(--of-control-disabled);
    background: var(--of-control-disabled);
    color: var(--of-control-text-disabled);
    cursor: not-allowed;
  }

  @media (prefers-reduced-motion: reduce) {
    button {
      transition: none;
    }
  }
</style>
