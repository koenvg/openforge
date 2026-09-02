<script lang="ts">
  import Select from '@openforge-app/plugin-sdk/ui/Select.svelte'

  interface Props {
    disabled?: boolean
    onValueChange?: (value: string) => void
    onOpenChange?: (open: boolean) => void
  }

  let { disabled = false, onValueChange, onOpenChange }: Props = $props()
  let value = $state('angular-light')
  let open = $state(false)

  const options = [
    { value: 'angular-light', label: 'Angular light' },
    { value: 'angular-dark', label: 'Angular dark' },
    { value: 'retired', label: 'Retired theme', disabled: true },
  ]
</script>

<button type="button" onclick={() => (value = 'angular-dark')}>Use dark theme</button>
<button type="button" onclick={() => (open = true)}>Open theme options</button>
<Select
  label="Theme"
  helperText="Choose the application appearance"
  {options}
  {disabled}
  bind:value
  bind:open
  {onValueChange}
  {onOpenChange}
/>
