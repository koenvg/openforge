<script lang="ts">
  import Switch from './Switch.svelte'

  let checked = $state(false)
  let lastChange = $state('none')
</script>

<Switch
  label="Enable notifications"
  bind:checked
  onCheckedChange={(nextChecked) => (lastChange = String(nextChecked))}
/>
<output aria-label="Bound state">{String(checked)}</output>
<output aria-label="Last change">{lastChange}</output>
