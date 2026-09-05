<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  interface Props extends Omit<HTMLInputAttributes, 'children' | 'size' | 'value'> {
    label: string
    /** Keep the accessible name when the caller renders the visible caption. */
    hideLabel?: boolean
    value?: string
    helperText?: string
    error?: string | null
    invalid?: boolean
    onValueChange?: (value: string) => void
  }

  const generatedId = $props.id()
  const helperId = `of-text-field-helper-${generatedId}`
  const errorId = `of-text-field-error-${generatedId}`

  let {
    label,
    hideLabel = false,
    value = $bindable(''),
    helperText,
    error = null,
    invalid = false,
    id = `of-text-field-${generatedId}`,
    class: className,
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedby,
    'aria-invalid': ariaInvalid,
    oninput,
    onValueChange,
    ...attributes
  }: Props = $props()

  let isInvalid = $derived(
    invalid || Boolean(error) || ariaInvalid === true || ariaInvalid === 'true',
  )
  let describedBy = $derived(
    [ariaDescribedby, helperText ? helperId : null, error ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined,
  )
</script>

<div class="of-text-field">
  {#if !hideLabel}<label for={id}>{label}</label>{/if}
  <input
    {...attributes}
    {id}
    class={className}
    {value}
    aria-label={hideLabel ? label : ariaLabel}
    aria-describedby={describedBy}
    aria-invalid={isInvalid ? 'true' : ariaInvalid}
    oninput={(event) => {
      value = event.currentTarget.value
      oninput?.(event)
      onValueChange?.(value)
    }}
  />
  {#if helperText}
    <span id={helperId} class="of-field-help">{helperText}</span>
  {/if}
  {#if error}
    <span id={errorId} class="of-field-error" role="alert">{error}</span>
  {/if}
</div>

<style>
  .of-text-field {
    display: grid;
    gap: var(--of-space2);
    color: var(--of-text);
    font-family: var(--of-font-sans);
  }

  label {
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
    line-height: var(--of-line-height-sm);
  }

  input {
    box-sizing: border-box;
    min-height: var(--of-control-height);
    padding: 0 var(--of-space3);
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-control);
    background: var(--of-field);
    color: var(--of-text);
    font: inherit;
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard),
      box-shadow var(--of-duration-fast) var(--of-ease-standard);
  }

  input:hover:not(:disabled) {
    background: var(--of-field-hover);
  }

  input:focus-visible {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  input[aria-invalid='true'] {
    border-color: var(--of-field-invalid);
  }

  input:disabled {
    background: var(--of-control-disabled);
    color: var(--of-control-text-disabled);
    cursor: not-allowed;
  }

  input::placeholder,
  .of-field-help {
    color: var(--of-text-muted);
  }

  .of-field-help,
  .of-field-error {
    font-size: var(--of-text-xs);
    line-height: var(--of-line-height-xs);
  }

  .of-field-error {
    color: var(--of-danger);
  }

  @media (prefers-reduced-motion: reduce) {
    input {
      transition: none;
    }
  }
</style>
