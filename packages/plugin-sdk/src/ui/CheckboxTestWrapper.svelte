<script lang="ts">
  import Checkbox from './Checkbox.svelte'

  let checked = $state(false)
  let lastChange = $state('none')
  let boundStateAtCallback = $state('none')
</script>

<label>
  <Checkbox
    bind:checked
    onCheckedChange={(nextChecked) => {
      lastChange = String(nextChecked)
      boundStateAtCallback = String(checked)
    }}
  />
  Include generated files
</label>
<output aria-label="Bound state">{String(checked)}</output>
<output aria-label="Last change">{lastChange}</output>
<output aria-label="Bound state at callback">{boundStateAtCallback}</output>
