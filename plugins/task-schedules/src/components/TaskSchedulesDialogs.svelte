<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
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
    <p class="dialog-copy">Your changes to this Task Schedule have not been saved.</p>
    <div class="dialog-actions">
      <Button variant="secondary" type="button" onClick={controller.cancelDiscard}>Keep editing</Button>
      <Button id="discard-schedule-changes" variant="danger" type="button" onClick={controller.discardChanges}>Discard changes</Button>
    </div>
  </Modal>
{/if}

{#if controller.schedulePendingDelete}
  <Modal ariaLabel="Delete Task Schedule confirmation" maxWidth="420px" initialFocus="#confirm-delete-schedule" closeDisabled={controller.deleting} onClose={controller.cancelDelete}>
    {#snippet header()}<h2 class="text-lg font-semibold">Delete {controller.schedulePendingDelete.title}?</h2>{/snippet}
    <p class="dialog-copy">This permanently deletes the Task Schedule. Existing Tasks and run history outside this Task Schedule are not removed.</p>
    <div class="dialog-actions">
      <Button variant="secondary" type="button" disabled={controller.deleting} onClick={controller.cancelDelete}>Cancel</Button>
      <Button id="confirm-delete-schedule" variant="danger" type="button" disabled={controller.deleting} onClick={() => { void controller.deleteSchedule() }}>{controller.deleting ? 'Deleting…' : 'Delete Task Schedule'}</Button>
    </div>
  </Modal>
{/if}

<style>
  .dialog-copy {
    margin: 0;
    color: var(--of-text-muted);
    font-size: var(--of-text-sm);
    line-height: var(--of-line-height-md);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--of-space2);
    margin-top: var(--of-space5);
  }
</style>
