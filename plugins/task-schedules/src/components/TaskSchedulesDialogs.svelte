<script lang="ts">
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import type { TaskSchedulesController } from './taskSchedulesController.svelte'

  interface Props {
    controller: TaskSchedulesController
  }

  let { controller }: Props = $props()
</script>

{#if controller.showDiscardConfirmation}
  <Modal ariaLabel="Discard Task Schedule changes" maxWidth="420px" initialFocus="#discard-schedule-changes" onClose={controller.cancelDiscard}>
    {#snippet header()}<h2 class="text-lg font-semibold">Discard unsaved changes?</h2>{/snippet}
    <p class="text-sm leading-6 text-secondary">Your changes to this Task Schedule have not been saved.</p>
    <div class="mt-5 flex justify-end gap-2">
      <button class="btn min-h-10" type="button" onclick={controller.cancelDiscard}>Keep editing</button>
      <button id="discard-schedule-changes" class="btn btn-error min-h-10" type="button" onclick={controller.discardChanges}>Discard changes</button>
    </div>
  </Modal>
{/if}

{#if controller.schedulePendingDelete}
  <Modal ariaLabel="Delete Task Schedule confirmation" maxWidth="420px" initialFocus="#confirm-delete-schedule" closeDisabled={controller.deleting} onClose={controller.cancelDelete}>
    {#snippet header()}<h2 class="text-lg font-semibold">Delete {controller.schedulePendingDelete.title}?</h2>{/snippet}
    <p class="text-sm leading-6 text-secondary">This permanently deletes the Task Schedule. Existing Tasks and run history outside this Task Schedule are not removed.</p>
    <div class="mt-5 flex justify-end gap-2">
      <button class="btn min-h-10" type="button" disabled={controller.deleting} onclick={controller.cancelDelete}>Cancel</button>
      <button id="confirm-delete-schedule" class="btn btn-error min-h-10" type="button" disabled={controller.deleting} onclick={() => { void controller.deleteSchedule() }}>{controller.deleting ? 'Deleting…' : 'Delete Task Schedule'}</button>
    </div>
  </Modal>
{/if}
