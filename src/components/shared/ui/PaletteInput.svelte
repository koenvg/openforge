<script lang="ts">
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  interface Props {
    listboxId: string
    activeDescendantId?: string
    value?: string
    placeholder: string
    expanded?: boolean
    onInput?: (event: Event) => void
  }

  let {
    listboxId,
    activeDescendantId,
    value = $bindable(''),
    placeholder,
    expanded = true,
    onInput,
  }: Props = $props()
</script>

<div class="p-3 border-b border-base-300">
  <TextField
    label={placeholder}
    hideLabel
    size="sm"
    data-palette-initial-focus
    type="text"
    {placeholder}
    bind:value
    oninput={onInput}
    role="combobox"
    aria-autocomplete="list"
    aria-controls={listboxId}
    aria-expanded={expanded}
    aria-activedescendant={activeDescendantId}
  />
</div>
