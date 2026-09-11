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
  <span class="of-checkbox-indicator" aria-hidden="true">
    <span class="of-checkbox-fill"></span>
    <svg class="of-checkbox-mark" viewBox="0 0 24 24" focusable="false">
      <path class="of-checkbox-check-mark" pathLength="1" d="M6.5 12.5 10.5 16.5 17.5 8.5"></path>
      <path class="of-checkbox-mixed-mark" d="M6 12h12"></path>
    </svg>
  </span>
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
    overflow: hidden;
    pointer-events: none;
    transition:
      border-color var(--of-duration-fast) var(--of-ease-standard),
      transform var(--of-duration-fast) var(--of-ease-standard);
  }

  .of-checkbox-fill {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--of-accent);
    transform: scale(0);
    transform-origin: center;
    transition: transform 150ms var(--of-ease-enter);
  }

  .of-checkbox-mark {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    z-index: 1;
  }

  .of-checkbox-check-mark,
  .of-checkbox-mixed-mark {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2.25;
  }

  .of-checkbox-check-mark {
    opacity: 0;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    transition:
      stroke-dashoffset 100ms var(--of-ease-enter),
      opacity 100ms var(--of-ease-enter);
  }

  .of-checkbox-mixed-mark {
    stroke-dasharray: 12;
    stroke-dashoffset: 12;
    transition: stroke-dashoffset 150ms var(--of-ease-enter);
  }

  input:hover:not(:disabled) + .of-checkbox-indicator {
    border-color: var(--of-border-strong);
  }

  input:active:not(:disabled) + .of-checkbox-indicator {
    transform: scale(0.9);
  }

  input:checked + .of-checkbox-indicator,
  input:indeterminate + .of-checkbox-indicator {
    border-color: var(--of-accent);
  }

  input:checked + .of-checkbox-indicator .of-checkbox-fill,
  input:indeterminate + .of-checkbox-indicator .of-checkbox-fill {
    transform: scale(1);
  }

  input:checked + .of-checkbox-indicator .of-checkbox-fill {
    animation: of-checkbox-fill-in 400ms var(--of-ease-enter) both;
  }

  input:checked + .of-checkbox-indicator {
    animation: of-checkbox-pop 400ms var(--of-ease-enter);
  }

  input:checked + .of-checkbox-indicator .of-checkbox-check-mark {
    opacity: 1;
    stroke-dashoffset: 0;
    transition:
      stroke-dashoffset 200ms var(--of-ease-enter) 60ms,
      opacity 10ms linear 60ms;
  }

  input:indeterminate + .of-checkbox-indicator .of-checkbox-mixed-mark {
    stroke-dashoffset: 0;
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
    .of-checkbox-fill,
    .of-checkbox-check-mark,
    .of-checkbox-mixed-mark {
      transition: none;
    }

    input:checked + .of-checkbox-indicator {
      animation: none;
    }

    input:checked + .of-checkbox-indicator .of-checkbox-fill {
      animation: none;
    }

    input:checked + .of-checkbox-indicator .of-checkbox-check-mark {
      transition: none;
    }
  }

  @keyframes of-checkbox-fill-in {
    0% { transform: scale(0); }
    60% { transform: scale(1.04); }
    100% { transform: scale(1); }
  }

  @keyframes of-checkbox-pop {
    0% { transform: scale(1); }
    30% { transform: scale(0.9); }
    70% { transform: scale(1.05); }
    100% { transform: scale(1); }
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
