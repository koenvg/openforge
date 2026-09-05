<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  interface Props extends Omit<HTMLInputAttributes, 'checked' | 'children' | 'size' | 'type'> {
    label: string
    /** Keep the accessible name when the caller renders the visible caption. */
    hideLabel?: boolean
    checked?: boolean
    error?: string | null
    invalid?: boolean
    onCheckedChange?: (checked: boolean) => void
  }

  const generatedId = $props.id()
  const errorId = `of-switch-error-${generatedId}`

  let {
    label,
    hideLabel = false,
    checked = $bindable(false),
    error = null,
    invalid = false,
    id = `of-switch-${generatedId}`,
    class: className,
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedby,
    'aria-invalid': ariaInvalid,
    onchange,
    onCheckedChange,
    ...attributes
  }: Props = $props()

  let isInvalid = $derived(
    invalid || Boolean(error) || ariaInvalid === true || ariaInvalid === 'true',
  )
  let describedBy = $derived(
    [ariaDescribedby, error ? errorId : null].filter(Boolean).join(' ') || undefined,
  )
</script>

<div class="of-switch">
  <label for={id}>
    <input
      {...attributes}
      {id}
      class={className}
      type="checkbox"
      role="switch"
      {checked}
      aria-label={hideLabel ? label : ariaLabel}
    aria-describedby={describedBy}
      aria-invalid={isInvalid ? 'true' : ariaInvalid}
      onchange={(event) => {
        checked = event.currentTarget.checked
        onchange?.(event)
        onCheckedChange?.(checked)
      }}
    />
    <span class="of-switch-track" aria-hidden="true"></span>
    {#if !hideLabel}<span class="of-switch-label">{label}</span>{/if}
  </label>
  {#if error}
    <span id={errorId} class="of-switch-error" role="alert">{error}</span>
  {/if}
</div>

<style>
  .of-switch {
    display: grid;
    gap: var(--of-space2);
    color: var(--of-text);
    font-family: var(--of-font-sans);
  }

  label {
    display: inline-flex;
    align-items: center;
    gap: var(--of-space2);
    width: fit-content;
    cursor: pointer;
  }

  input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    opacity: 0;
  }

  .of-switch-track {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    width: calc(var(--of-control-height-compact) + var(--of-space3));
    height: var(--of-control-height-compact);
    padding: var(--of-space1);
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-round);
    background: var(--of-control);
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard);
  }

  .of-switch-track::before {
    width: calc(var(--of-control-height-compact) - (var(--of-space1) * 2) - (var(--of-border-width) * 2));
    height: calc(var(--of-control-height-compact) - (var(--of-space1) * 2) - (var(--of-border-width) * 2));
    border-radius: var(--of-radius-round);
    background: var(--of-control-text);
    content: '';
    transition: transform var(--of-duration-fast) var(--of-ease-standard);
  }

  input:checked + .of-switch-track {
    border-color: var(--of-accent);
    background: var(--of-accent);
  }

  input:checked + .of-switch-track::before {
    background: var(--of-on-accent);
    transform: translateX(var(--of-space3));
  }

  input:focus-visible + .of-switch-track {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  input[aria-invalid='true'] + .of-switch-track {
    border-color: var(--of-danger);
  }

  input:disabled + .of-switch-track {
    background: var(--of-control-disabled);
  }

  input:disabled ~ .of-switch-label {
    color: var(--of-control-text-disabled);
  }

  label:has(input:disabled) {
    cursor: not-allowed;
  }

  .of-switch-label {
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
    line-height: var(--of-line-height-sm);
  }

  .of-switch-error {
    color: var(--of-danger);
    font-size: var(--of-text-xs);
    line-height: var(--of-line-height-xs);
  }

  @media (prefers-reduced-motion: reduce) {
    .of-switch-track,
    .of-switch-track::before {
      transition: none;
    }
  }
</style>
