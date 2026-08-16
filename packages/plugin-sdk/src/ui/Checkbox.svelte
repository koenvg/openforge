<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  type CheckboxSize = 'xs' | 'sm' | 'md'

  interface Props extends Omit<HTMLInputAttributes, 'checked' | 'size' | 'type'> {
    checked?: boolean
    indeterminate?: boolean
    size?: CheckboxSize
  }

  let {
    checked = $bindable(false),
    indeterminate = false,
    size = 'sm',
    class: className,
    onchange,
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
  {onchange}
/>

<style>
  .of-checkbox {
    width: 1.25rem;
    height: 1.25rem;
    flex: none;
    appearance: none;
    display: inline-grid;
    place-content: center;
    margin: 0;
    border: 2px solid color-mix(in oklab, var(--color-base-content) 55%, transparent);
    border-radius: 0.25rem;
    background: var(--color-base-100);
    color: var(--color-primary-content);
    cursor: pointer;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      box-shadow 150ms ease;
  }

  .of-checkbox::before {
    width: 0.75rem;
    height: 0.75rem;
    background: currentColor;
    clip-path: polygon(14% 44%, 0 59%, 40% 100%, 100% 19%, 84% 4%, 39% 73%);
    content: '';
    transform: scale(0);
    transform-origin: center;
    transition: transform 120ms ease-out;
  }

  .of-checkbox:hover:not(:disabled) {
    border-color: var(--color-primary);
  }

  .of-checkbox:checked,
  .of-checkbox:indeterminate {
    border-color: var(--color-primary);
    background: var(--color-primary);
  }

  .of-checkbox:checked::before {
    transform: scale(1);
  }

  .of-checkbox:indeterminate::before {
    width: 0.625rem;
    height: 0.125rem;
    clip-path: none;
    transform: scale(1);
  }

  .of-checkbox:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  .of-checkbox:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .of-checkbox[data-size='xs'] {
    width: 1rem;
    height: 1rem;
  }

  .of-checkbox[data-size='xs']::before {
    width: 0.625rem;
    height: 0.625rem;
  }

  .of-checkbox[data-size='md'] {
    width: 1.5rem;
    height: 1.5rem;
  }

  .of-checkbox[data-size='md']::before {
    width: 0.875rem;
    height: 0.875rem;
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
