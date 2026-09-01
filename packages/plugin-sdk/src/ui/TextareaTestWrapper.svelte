<script lang="ts">
  import Textarea from './Textarea.svelte'

  let value = $state('Initial note')
  let lastChange = $state('none')
</script>

<Textarea
  label="Review note"
  bind:value
  onValueChange={(nextValue) => (lastChange = nextValue)}
/>
<output aria-label="Bound value">{value}</output>
<output aria-label="Last change">{lastChange}</output>
