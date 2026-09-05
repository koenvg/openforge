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
  let formSubmitted = $state(false)

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    formSubmitted = true
  }
</script>

<form onsubmit={handleSubmit}>
  <button type="button">Menu trigger</button>

  <ContextMenu {visible} {x} {y} {onClose}>
    <ContextMenuItem label="Unavailable Item" disabled onclick={() => { clickedItem = 'Unavailable Item' }} />
    <ContextMenuItem label="Test Item" onclick={() => { clickedItem = 'Test Item' }} />
    <ContextMenuItem label="Danger Item" description="Helpful context" variant="danger" onclick={() => { clickedItem = 'Danger Item' }} />
  </ContextMenu>
</form>

<span data-testid="form-submitted">{String(formSubmitted)}</span>

{#if clickedItem}
  <span data-testid="clicked-item">{clickedItem}</span>
{/if}
