<script lang="ts">
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'

  interface Props {
    onClose: () => void
    closeDisabled?: boolean
    initialFocus?: string
    onKeydown?: (event: KeyboardEvent) => boolean | void
  }

  let { onClose, closeDisabled = false, initialFocus, onKeydown }: Props = $props()
</script>

<Modal ariaLabel="Plugin dialog" closeLabel="Close plugin dialog" {closeDisabled} {initialFocus} {onClose} {onKeydown}>
  {#snippet header()}
    <h2>Plugin dialog</h2>
  {/snippet}

  <div>
    <input aria-label="First field" data-testid="first-field" />
    <button type="button">Last action</button>
  </div>
</Modal>
