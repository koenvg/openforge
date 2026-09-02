<script lang="ts">
  import { Select } from 'bits-ui'

  export type SelectOption = Readonly<{
    value: string
    label: string
    disabled?: boolean
  }>

  interface Props {
    label: string
    options: readonly SelectOption[]
    value?: string
    open?: boolean
    placeholder?: string
    helperText?: string
    error?: string | null
    invalid?: boolean
    disabled?: boolean
    required?: boolean
    name?: string
    id?: string
    class?: string
    testId?: string
    onValueChange?: (value: string) => void
    onOpenChange?: (open: boolean) => void
  }

  const generatedId = $props.id()
  const labelId = `of-select-label-${generatedId}`
  const helperId = `of-select-helper-${generatedId}`
  const errorId = `of-select-error-${generatedId}`

  let {
    label,
    options,
    value = $bindable(''),
    open = $bindable(false),
    placeholder = 'Select an option',
    helperText,
    error = null,
    invalid = false,
    disabled = false,
    required = false,
    name,
    id = `of-select-${generatedId}`,
    class: className,
    testId,
    onValueChange,
    onOpenChange,
  }: Props = $props()

  let rootItems = $derived(options.map(({ value: optionValue, label: optionLabel, disabled: optionDisabled }) => ({
    value: optionValue,
    label: optionLabel,
    disabled: optionDisabled,
  })))
  let describedBy = $derived(
    [helperText ? helperId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined,
  )
  let isInvalid = $derived(invalid || Boolean(error))
  let selectedOption = $derived(options.find((option) => option.value === value))
</script>

<div class="of-select-field {className ?? ''}" data-testid={testId}>
  <span id={labelId} class="of-select-label">{label}</span>
  <Select.Root
    type="single"
    items={rootItems}
    bind:value
    bind:open
    {disabled}
    {required}
    {name}
    {onValueChange}
    {onOpenChange}
  >
    <Select.Trigger
      {id}
      class="of-select-trigger"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-invalid={isInvalid ? 'true' : undefined}
    >
      <span data-placeholder={selectedOption ? undefined : ''}>{selectedOption?.label ?? placeholder}</span>
      <svg class="of-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <path d="m7 10 5 5 5-5" />
      </svg>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content class="of-select-content" sideOffset={4}>
        <Select.Viewport class="of-select-viewport">
          {#each options as option (option.value)}
            <Select.Item
              class="of-select-option"
              value={option.value}
              label={option.label}
              disabled={option.disabled}
              aria-disabled={option.disabled ? 'true' : undefined}
            >
              {#snippet children({ selected })}
                <span>{option.label}</span>
                {#if selected}
                  <svg class="of-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                {/if}
              {/snippet}
            </Select.Item>
          {/each}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
  {#if helperText}
    <span id={helperId} class="of-select-help">{helperText}</span>
  {/if}
  {#if error}
    <span id={errorId} class="of-select-error" role="alert">{error}</span>
  {/if}
</div>

<style>
  .of-select-field {
    display: grid;
    gap: var(--of-space2);
    color: var(--of-text);
    font-family: var(--of-font-sans);
  }

  .of-select-label {
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
    line-height: var(--of-line-height-sm);
  }

  :global(.of-select-trigger) {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: var(--of-space2);
    min-height: var(--of-control-height);
    padding: 0 var(--of-space3);
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-control);
    background: var(--of-field);
    color: var(--of-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard),
      box-shadow var(--of-duration-fast) var(--of-ease-standard);
  }

  :global(.of-select-trigger:hover:not(:disabled)) {
    background: var(--of-field-hover);
  }

  :global(.of-select-trigger:focus-visible) {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  :global(.of-select-trigger[aria-invalid='true']) {
    border-color: var(--of-field-invalid);
  }

  :global(.of-select-trigger:disabled) {
    background: var(--of-control-disabled);
    color: var(--of-control-text-disabled);
    cursor: not-allowed;
  }

  .of-select-chevron {
    width: var(--of-space4);
    height: var(--of-space4);
    margin-left: auto;
  }

  :global(.of-select-content) {
    z-index: 1100;
    box-sizing: border-box;
    min-width: var(--bits-select-anchor-width);
    max-height: var(--bits-select-content-available-height);
    overflow: hidden;
    border: var(--of-border-width) solid var(--of-border-strong);
    border-radius: var(--of-radius-overlay);
    background: var(--of-surface-raised);
    color: var(--of-text);
    box-shadow: var(--of-shadow-raised);
    font-family: var(--of-font-sans);
  }

  :global(.of-select-viewport) {
    max-height: min(20rem, var(--bits-select-content-available-height));
    padding: var(--of-space1);
  }

  :global(.of-select-option) {
    display: flex;
    align-items: center;
    gap: var(--of-space2);
    min-height: var(--of-control-height);
    padding: 0 var(--of-space3);
    border-radius: var(--of-radius-control);
    outline: none;
    font-size: var(--of-text-sm);
    line-height: var(--of-line-height-sm);
    cursor: pointer;
  }

  :global(.of-select-option[data-highlighted]) {
    background: var(--of-control-hover);
  }

  :global(.of-select-option[data-selected]) {
    background: var(--of-accent-subtle);
    color: var(--of-on-accent-subtle);
  }

  :global(.of-select-option[data-disabled]) {
    color: var(--of-control-text-disabled);
    cursor: not-allowed;
  }

  .of-select-check {
    width: var(--of-space4);
    height: var(--of-space4);
    margin-left: auto;
  }

  .of-select-help,
  .of-select-error {
    font-size: var(--of-text-xs);
    line-height: var(--of-line-height-xs);
  }

  .of-select-help {
    color: var(--of-text-muted);
  }

  .of-select-error {
    color: var(--of-danger);
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.of-select-trigger) {
      transition: none;
    }
  }
</style>
