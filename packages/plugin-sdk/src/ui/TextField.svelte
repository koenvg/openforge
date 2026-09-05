<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLInputAttributes } from 'svelte/elements'

  interface Props extends Omit<HTMLInputAttributes, 'children' | 'size' | 'value'> {
    label: string
    /** Keep the accessible name when the caller renders the visible caption. */
    hideLabel?: boolean
    labelHidden?: boolean
    size?: 'sm' | 'md'
    leading?: Snippet
    trailing?: Snippet
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
    labelHidden = false,
    size = 'md',
    leading,
    trailing,
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

<div class="of-text-field" data-size={size}>
  {#if !hideLabel}
    <label for={id} class:visually-hidden={labelHidden}>{label}</label>
  {/if}
  <div class="of-field-control">
    {#if leading}
      <div class="of-field-adornment">{@render leading()}</div>
    {/if}
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
    {#if trailing}
      <div class="of-field-adornment">{@render trailing()}</div>
    {/if}
  </div>
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
    min-width: 0;
    gap: var(--of-space2);
    color: var(--of-text);
    font-family: var(--of-font-sans);
  }

  label {
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
    line-height: var(--of-line-height-sm);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  .of-field-control {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--of-space2);
    padding-inline: var(--of-space3);
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-control);
    background: var(--of-field);
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard),
      box-shadow var(--of-duration-fast) var(--of-ease-standard);
  }

  input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    min-height: calc(var(--of-control-height) - 2 * var(--of-border-width));
    flex: 1;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
  }

  .of-text-field[data-size='sm'] .of-field-control {
    padding-inline: var(--of-space2);
    font-size: var(--of-text-xs);
  }

  .of-text-field[data-size='sm'] input {
    min-height: calc(var(--of-control-height-compact) - 2 * var(--of-border-width));
  }

  .of-field-adornment {
    display: flex;
    flex: none;
    align-items: center;
    color: var(--of-text-muted);
  }

  .of-field-control:hover:not(:has(input:disabled)) {
    background: var(--of-field-hover);
  }

  .of-field-control:has(input:focus-visible) {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  input:focus-visible {
    outline: none;
  }

  .of-field-control:has(input[aria-invalid='true']) {
    border-color: var(--of-field-invalid);
  }

  .of-field-control:has(input:disabled) {
    background: var(--of-control-disabled);
    color: var(--of-control-text-disabled);
    cursor: not-allowed;
  }

  input:disabled {
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
    .of-field-control {
      transition: none;
    }
  }
</style>
