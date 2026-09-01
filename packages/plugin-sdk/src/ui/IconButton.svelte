<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  type IconButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg'

  interface Props extends Omit<HTMLButtonAttributes, 'aria-label' | 'children'> {
    label: string
    children: Snippet
    variant?: IconButtonVariant
    size?: IconButtonSize
    onClick?: (event: MouseEvent) => void
  }

  let {
    label,
    children,
    variant = 'ghost',
    size = 'md',
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
  aria-label={label}
  data-variant={variant}
  data-size={size}
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
    display: inline-grid;
    place-content: center;
    width: var(--of-control-height);
    height: var(--of-control-height);
    padding: var(--of-space2);
    border: var(--of-border-width) solid transparent;
    border-radius: var(--of-radius-control);
    background: transparent;
    color: var(--of-icon);
    cursor: pointer;
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard),
      color var(--of-duration-fast) var(--of-ease-standard);
  }

  button:hover:not(:disabled) {
    background: var(--of-control-hover);
    color: var(--of-text);
  }

  button:active:not(:disabled) {
    background: var(--of-control-pressed);
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

  button[data-size='xs'],
  button[data-size='sm'] {
    width: var(--of-control-height-compact);
    height: var(--of-control-height-compact);
    padding: var(--of-space1);
  }

  button[data-size='lg'] {
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
