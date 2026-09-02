<script lang="ts">
  import AnchoredMenu from '@openforge-app/plugin-sdk/ui/AnchoredMenu.svelte'

  interface Props {
    disabled?: boolean
    onOpenChange?: (open: boolean) => void
    onSelect?: (value: string) => void
  }

  let { disabled = false, onOpenChange, onSelect }: Props = $props()
  let open = $state(false)
  const items = [
    { value: 'rename', label: 'Rename' },
    { value: 'archive', label: 'Archive', disabled: true },
    { value: 'delete', label: 'Delete', danger: true },
  ]
</script>

<button type="button" onclick={() => (open = true)}>Open actions externally</button>
<AnchoredMenu label="Task actions" {items} {disabled} bind:open {onOpenChange} {onSelect}>
  {#snippet trigger()}
    Actions
  {/snippet}
</AnchoredMenu>
