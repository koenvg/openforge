<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import type { AppCloseController } from '../../lib/appCloseController.svelte'

  interface Props {
    controller: AppCloseController
  }

  let { controller }: Props = $props()
</script>

{#if controller.confirmationOpen}
  <Modal
    onClose={controller.cancelClose}
    maxWidth="360px"
    initialFocus="[data-close-confirm-action='quit']"
    ariaLabel="Agents still running"
  >
    {#snippet header()}
      <h2 class="text-[0.95rem] font-semibold text-base-content m-0">Agents still running</h2>
    {/snippet}
    <div class="p-5 flex flex-col gap-4">
      <p class="text-sm text-base-content/70 m-0">One or more agents are still running or waiting for your input. Quitting now will stop them. Are you sure you want to quit?</p>
      <div class="flex justify-end gap-2">
        <Button variant="ghost" size="sm" type="button" onclick={controller.cancelClose}>Cancel</Button>
        <Button data-close-confirm-action="quit" variant="danger" size="sm" type="button" onclick={controller.confirmClose}>Quit</Button>
      </div>
    </div>
  </Modal>
{/if}
