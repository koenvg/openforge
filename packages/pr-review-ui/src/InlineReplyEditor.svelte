<script lang="ts">
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
  <input
    class="input input-bordered input-xs flex-1"
    aria-label={ariaLabel}
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
  {#if secondaryLabel && onSecondarySubmit}
    <button
      type="button"
      class="btn btn-xs btn-outline"
      title={secondaryTitle}
      onclick={onSecondarySubmit}
    >{secondaryLabel}</button>
  {/if}
  <button
    type="button"
    class="btn btn-xs btn-primary"
    title={primaryTitle}
    onclick={onSubmit}
  >{primaryLabel}</button>
</div>
