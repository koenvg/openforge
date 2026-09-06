<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  interface Props {
    value: string
    ariaLabel: string
    placeholder: string
    primaryLabel: string
    onValueChange: (value: string) => void
    onSubmit: () => void
    primaryTitle?: string
    secondaryLabel?: string
    secondaryTitle?: string
    onSecondarySubmit?: () => void
    class?: string
  }

  let {
    value,
    ariaLabel,
    placeholder,
    primaryLabel,
    onValueChange,
    onSubmit,
    primaryTitle,
    secondaryLabel,
    secondaryTitle,
    onSecondarySubmit,
    class: className = 'mt-1.5',
  }: Props = $props()
</script>

<div class="flex gap-2 {className}">
  <div class="flex-1">
  <TextField
    label={ariaLabel}
    hideLabel
    size="sm"
    {placeholder}
    {value}
    oninput={(event) => {
      if (!(event.currentTarget instanceof HTMLInputElement)) return
      onValueChange(event.currentTarget.value)
    }}
    onkeydown={(event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      onSubmit()
    }}
  />
  </div>
  {#if secondaryLabel && onSecondarySubmit}
    <Button
      variant="outline"
      size="xs"
      type="button"
      title={secondaryTitle}
      onclick={onSecondarySubmit}
    >{secondaryLabel}</Button>
  {/if}
  <Button
    size="xs"
    type="button"
    title={primaryTitle}
    onclick={onSubmit}
  >{primaryLabel}</Button>
</div>
