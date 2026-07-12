<script lang="ts">
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
  <input
    data-palette-initial-focus
    type="text"
    class="input input-sm w-full bg-base-100 border-base-300 focus:outline-none text-base-content placeholder:text-base-content/40"
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
