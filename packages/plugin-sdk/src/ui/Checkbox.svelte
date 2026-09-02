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

<span class={["of-checkbox", className]} data-size={size}>
  <input
    {...attributes}
    class={className}
    bind:this={input}
    bind:checked
    type="checkbox"
    aria-checked={indeterminate ? 'mixed' : undefined}
    onchange={(event) => {
      checked = event.currentTarget.checked
      onchange?.(event)
      onCheckedChange?.(event.currentTarget.checked)
    }}
  />
  <span class="of-checkbox-indicator" aria-hidden="true"></span>
</span>

<style>
  .of-checkbox {
    position: relative;
    box-sizing: border-box;
    display: inline-grid;
    width: var(--of-control-height-compact);
    height: var(--of-control-height-compact);
    flex: none;
    color: var(--of-on-accent);
    vertical-align: middle;
  }

  .of-checkbox > input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .of-checkbox-indicator {
    box-sizing: border-box;
    position: relative;
    width: 100%;
    height: 100%;
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-control);
    background: var(--of-field);
    pointer-events: none;
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard),
      box-shadow var(--of-duration-fast) var(--of-ease-standard);
  }

  .of-checkbox-indicator::before {
    position: absolute;
    top: 20%;
    left: 20%;
    width: 60%;
    height: 60%;
    background: currentColor;
    clip-path: polygon(14% 44%, 0 59%, 40% 100%, 100% 19%, 84% 4%, 39% 73%);
    content: '';
    transform: scale(0);
    transform-origin: center;
    transition: transform var(--of-duration-press) var(--of-ease-enter);
  }

  input:hover:not(:disabled) + .of-checkbox-indicator {
    border-color: var(--of-accent);
    background: var(--of-field-hover);
  }

  input:checked + .of-checkbox-indicator,
  input:indeterminate + .of-checkbox-indicator {
    border-color: var(--of-accent);
    background: var(--of-accent);
  }

  input:checked + .of-checkbox-indicator::before {
    transform: scale(1);
  }

  input:indeterminate + .of-checkbox-indicator::before {
    top: 50%;
    left: 22.5%;
    width: 55%;
    height: var(--of-border-width);
    clip-path: none;
    transform: translateY(-50%) scale(1);
  }

  input:focus-visible + .of-checkbox-indicator {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  input:disabled {
    cursor: not-allowed;
  }

  input:disabled + .of-checkbox-indicator {
    border-color: var(--of-control-disabled);
    background: var(--of-control-disabled);
    color: var(--of-control-text-disabled);
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
    .of-checkbox-indicator,
    .of-checkbox-indicator::before {
      transition: none;
    }
  }

  @media (forced-colors: active) {
    .of-checkbox > input {
      appearance: auto;
      opacity: 1;
    }

    .of-checkbox-indicator {
      display: none;
    }
  }
</style>
