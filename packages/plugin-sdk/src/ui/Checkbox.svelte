<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  type CheckboxSize = 'xs' | 'sm' | 'md'

  interface Props extends Omit<HTMLInputAttributes, 'checked' | 'size' | 'type'> {
    checked?: boolean
    indeterminate?: boolean
    size?: CheckboxSize
    onCheckedChange?: (checked: boolean) => void
  }

  let {
    checked = $bindable(false),
    indeterminate = false,
    size = 'sm',
    class: className,
    onchange,
    onCheckedChange,
    ...attributes
  }: Props = $props()

  let input = $state<HTMLInputElement | null>(null)

  $effect(() => {
    if (input) input.indeterminate = indeterminate
  })
</script>

<input
  {...attributes}
  bind:this={input}
  bind:checked
  type="checkbox"
  class={["of-checkbox", className]}
  data-size={size}
  aria-checked={indeterminate ? 'mixed' : undefined}
  onchange={(event) => {
    checked = event.currentTarget.checked
    onchange?.(event)
    onCheckedChange?.(event.currentTarget.checked)
  }}
/>

<style>
  .of-checkbox {
    box-sizing: border-box;
    width: var(--of-control-height-compact);
    height: var(--of-control-height-compact);
    flex: none;
    appearance: none;
    display: inline-grid;
    place-content: center;
    margin: 0;
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-control);
    background: var(--of-field);
    color: var(--of-on-accent);
    cursor: pointer;
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard),
      box-shadow var(--of-duration-fast) var(--of-ease-standard);
  }

  .of-checkbox::before {
    width: 60%;
    height: 60%;
    background: currentColor;
    clip-path: polygon(14% 44%, 0 59%, 40% 100%, 100% 19%, 84% 4%, 39% 73%);
    content: '';
    transform: scale(0);
    transform-origin: center;
    transition: transform var(--of-duration-press) var(--of-ease-enter);
  }

  .of-checkbox:hover:not(:disabled) {
    border-color: var(--of-accent);
    background: var(--of-field-hover);
  }

  .of-checkbox:checked,
  .of-checkbox:indeterminate {
    border-color: var(--of-accent);
    background: var(--of-accent);
  }

  .of-checkbox:checked::before {
    transform: scale(1);
  }

  .of-checkbox:indeterminate::before {
    width: 55%;
    height: var(--of-border-width);
    clip-path: none;
    transform: scale(1);
  }

  .of-checkbox:focus-visible {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  .of-checkbox:disabled {
    border-color: var(--of-control-disabled);
    background: var(--of-control-disabled);
    color: var(--of-control-text-disabled);
    cursor: not-allowed;
  }

  .of-checkbox[data-size='xs'] {
    width: calc(var(--of-control-height-compact) - var(--of-space2));
    height: calc(var(--of-control-height-compact) - var(--of-space2));
  }

  .of-checkbox[data-size='md'] {
    width: var(--of-control-height);
    height: var(--of-control-height);
  }

  @media (prefers-reduced-motion: reduce) {
    .of-checkbox,
    .of-checkbox::before {
      transition: none;
    }
  }

  @media (forced-colors: active) {
    .of-checkbox {
      appearance: auto;
    }

    .of-checkbox::before {
      display: none;
    }
  }
</style>
