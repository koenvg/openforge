<script lang="ts">
  import TextField from './TextField.svelte'

  let value = $state('initial')
  let lastChange = $state('none')
</script>

<TextField
  label="Repository name"
  name="repository"
  bind:value
  onValueChange={(nextValue) => (lastChange = nextValue)}
/>
<output aria-label="Bound value">{value}</output>
<output aria-label="Last change">{lastChange}</output>
