<script lang="ts">
  import ContextMenu from './ContextMenu.svelte'
  import ContextMenuItem from './ContextMenuItem.svelte'

  interface Props {
    visible: boolean
    x: number
    y: number
    onClose: () => void
  }

  let { visible, x, y, onClose }: Props = $props()
  let clickedItem = $state('')
</script>

<button type="button">Menu trigger</button>

<ContextMenu {visible} {x} {y} {onClose}>
  <ContextMenuItem label="Unavailable Item" disabled onclick={() => { clickedItem = 'Unavailable Item' }} />
  <ContextMenuItem label="Test Item" onclick={() => { clickedItem = 'Test Item' }} />
  <ContextMenuItem label="Danger Item" variant="danger" onclick={() => { clickedItem = 'Danger Item' }} />
</ContextMenu>

{#if clickedItem}
  <span data-testid="clicked-item">{clickedItem}</span>
{/if}
