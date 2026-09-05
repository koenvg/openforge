<script lang="ts">
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'

  let { disabled = false, readonly = false } = $props<{ disabled?: boolean; readonly?: boolean }>()
  let value = $state('initial')
  let nativeValue = $state('none')
  let lastChange = $state('none')
  let lastKey = $state('none')
</script>

<form aria-label="Task filters" onsubmit={(event) => event.preventDefault()}>
  <TextField
    label="Filter tasks"
    labelHidden
    size="sm"
    name="query"
    class="task-filter-input"
    {disabled}
    {readonly}
    bind:value
    aria-describedby="filter-help"
    helperText="Search by title."
    error="No matching task."
    oninput={(event) => (nativeValue = event.currentTarget.value)}
    onValueChange={(nextValue) => (lastChange = nextValue)}
    onkeydown={(event) => (lastKey = event.key)}
  >
    {#snippet leading()}<span aria-hidden="true">Search icon</span>{/snippet}
    {#snippet trailing()}
      <button type="button" disabled={disabled || readonly} onclick={() => (value = '')}>Clear filter</button>
    {/snippet}
  </TextField>
  <span id="filter-help">Filter the task list.</span>
</form>
<output aria-label="Bound value">{value}</output>
<output aria-label="Native input value">{nativeValue}</output>
<output aria-label="Last change">{lastChange}</output>
<output aria-label="Last key">{lastKey}</output>
