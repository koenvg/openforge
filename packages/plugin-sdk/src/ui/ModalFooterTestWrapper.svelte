<script lang="ts">
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'

  let { onClose }: { onClose: () => void } = $props()
</script>

<Modal ariaLabel="Plugin dialog" {onClose}>
  <p>Dialog content</p>

  {#snippet footer()}
    <button type="button">Save changes</button>
  {/snippet}
</Modal>
