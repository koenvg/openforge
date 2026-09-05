<script lang="ts">
  import AnchoredMenu from '@openforge-app/plugin-sdk/ui/AnchoredMenu.svelte'

  interface Props {
    disabled?: boolean
    multiple?: boolean
    onOpenChange?: (open: boolean) => void
    onSelect?: (value: string) => void
  }

  let { disabled = false, multiple = false, onOpenChange, onSelect }: Props = $props()
  let open = $state(false)
  let checkedValues = $state(new Set(['rename']))
  let items = $derived(multiple
    ? [
        { value: 'rename', label: 'Rename', checked: checkedValues.has('rename'), closeOnSelect: false },
        { value: 'delete', label: 'Delete', checked: checkedValues.has('delete'), closeOnSelect: false },
      ]
    : [
        { value: 'rename', label: 'Rename' },
        { value: 'archive', label: 'Archive', disabled: true },
        { value: 'delete', label: 'Delete', danger: true },
      ])

  function handleSelect(value: string) {
    if (multiple) {
      const next = new Set(checkedValues)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      checkedValues = next
    }
    onSelect?.(value)
  }
</script>

<button type="button" onclick={() => (open = true)}>Open actions externally</button>
<AnchoredMenu label="Task actions" {items} {disabled} bind:open {onOpenChange} onSelect={handleSelect}>
  {#snippet trigger()}
    Actions
  {/snippet}
  {#snippet item(item)}
    <span>{item.label}</span>
    {#if multiple}<span aria-hidden="true">{item.value === 'rename' ? '3' : '2'}</span>{/if}
  {/snippet}
</AnchoredMenu>
