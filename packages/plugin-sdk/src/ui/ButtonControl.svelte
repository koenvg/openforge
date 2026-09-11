<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  type ButtonControlVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'link' | 'destructive'
  type ButtonControlSize = 'xs' | 'sm' | 'md' | 'lg'
  type ButtonControlKind = 'text' | 'icon'

  interface Props extends HTMLButtonAttributes {
    children: Snippet
    variant: ButtonControlVariant
    size: ButtonControlSize
    kind: ButtonControlKind
    loading?: boolean
    onClick?: (event: MouseEvent) => void
    element?: HTMLButtonElement
  }

  let {
    children,
    variant,
    size,
    kind,
    loading = false,
    element = $bindable(),
    class: className,
    disabled = false,
    onclick,
    onClick,
    ...attributes
  }: Props = $props()
</script>

<button
  bind:this={element}
  {...attributes}
  class={className}
  data-variant={variant}
  data-size={size}
  data-control-kind={kind}
  data-loading={loading ? 'true' : undefined}
  {disabled}
  onclick={(event) => {
    if (!disabled) {
      onclick?.(event)
      onClick?.(event)
    }
  }}
>
  {#if loading}
    <span class="of-button-spinner" aria-hidden="true"></span>
  {/if}
  {#if kind === 'text' || !loading}
  {@render children()}
  {/if}
</button>

<style>
  button {
    box-sizing: border-box;
    border: var(--of-border-width) solid transparent;
    border-radius: var(--of-radius-control);
    appearance: none;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
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
    gap: var(--of-space2);
    min-height: var(--of-control-height);
    padding: 0 var(--of-space4);
    font-family: var(--of-font-sans);
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
    line-height: var(--of-line-height-sm);
  }

  button[data-control-kind='icon'] {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--of-control-height);
    height: var(--of-control-height);
    padding: var(--of-space2);
  }

  button[data-variant='primary'] {
    /* Keep the transparent border's geometry. Painting the same rounded edge
       twice produces unstable antialiasing at fractional layout positions. */
    background: var(--of-accent);
    color: var(--of-on-accent);
  }

  button[data-variant='primary']:hover:not(:disabled) {
    background: var(--of-accent-hover);
    color: var(--of-on-accent);
  }

  button[data-variant='primary']:active:not(:disabled) {
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

  button[data-variant='link'] {
    border-color: transparent;
    background: transparent;
    color: var(--of-link);
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

  button[data-variant='destructive'] {
    border-color: var(--of-danger);
    background: var(--of-danger);
    color: var(--of-on-danger);
  }

  button[data-variant='destructive']:hover:not(:disabled),
  button[data-variant='destructive']:active:not(:disabled) {
    border-color: var(--of-status-danger);
    background: var(--of-status-danger);
    color: var(--of-on-danger);
  }

  button[data-variant='link']:hover:not(:disabled) {
    background: transparent;
    color: var(--of-link);
    text-decoration: underline;
    text-underline-offset: 0.18em;
  }

  button[data-variant='link']:active:not(:disabled) {
    background: transparent;
    color: var(--of-link);
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

  button[data-variant='ghost']:disabled,
  button[data-variant='link']:disabled {
    border-color: transparent;
    background: transparent;
  }

  button[data-variant='outline']:disabled {
    background: transparent;
  }

  .of-button-spinner {
    box-sizing: border-box;
    display: inline-block;
    flex: 0 0 auto;
    width: 1em;
    height: 1em;
    border: var(--of-border-width) solid currentColor;
    border-right-color: transparent;
    border-radius: var(--of-radius-round);
    animation: of-button-spin 700ms linear infinite;
  }

  @keyframes of-button-spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    button {
      transition: none;
    }

    .of-button-spinner {
      animation: none;
    }
  }
</style>
