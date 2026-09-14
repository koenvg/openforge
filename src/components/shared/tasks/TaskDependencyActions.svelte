<script lang="ts">
  import Tooltip from '@openforge-app/plugin-sdk/ui/Tooltip.svelte'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import Check from '@lucide/svelte/icons/check'
  import X from '@lucide/svelte/icons/x'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'

  interface Props {
    taskId: string
    dependencyId: string
    confirming: boolean
    disabled: boolean
    removing: boolean
    onRequest: () => void
    onConfirm: () => void
    onCancel: () => void
  }

  let { taskId, dependencyId, confirming, disabled, removing, onRequest, onConfirm, onCancel }: Props = $props()
  let confirmationLabel = $derived(`Confirm removing ${dependencyId} from ${taskId}. ${taskId} will no longer wait for ${dependencyId}. Neither task is deleted.`)
  let trailingSlot: HTMLSpanElement | undefined = $state()

  $effect(() => {
    if (confirming) trailingSlot?.querySelector('button')?.focus()
  })

  function handleKeydown(event: KeyboardEvent) {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
    }
    if (event.key === 'Escape' && confirming) {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
  }

  function confirm(event: MouseEvent) {
    if (!disabled && event.detail < 2) onConfirm()
  }
</script>

<div class="dependency-actions" aria-busy={removing}>
  <span class="action-slot">
    {#if confirming}
      <Tooltip label={confirmationLabel} content={confirmationLabel} {disabled} onTriggerClick={confirm} onTriggerKeydown={handleKeydown} triggerClass="dependency-confirm">
        {#snippet trigger()}<Check size={14} aria-hidden="true" />{/snippet}
      </Tooltip>
    {/if}
  </span>
  <span class="action-slot" bind:this={trailingSlot}>
    {#if confirming}
      <Tooltip label={`Cancel removing dependency ${dependencyId}`} content="Cancel removal" {disabled} onTriggerClick={onCancel} onTriggerKeydown={handleKeydown}>
        {#snippet trigger()}<X size={14} aria-hidden="true" />{/snippet}
      </Tooltip>
    {:else}
      <Tooltip label={`Remove dependency ${dependencyId}`} content={`Remove dependency ${dependencyId}`} {disabled} onTriggerClick={onRequest} onTriggerKeydown={handleKeydown}>
        {#snippet trigger()}
          {#if removing}<LoaderCircle size={14} aria-hidden="true" class="motion-safe:animate-spin" />
          {:else}<Trash2 size={14} aria-hidden="true" />{/if}
        {/snippet}
      </Tooltip>
    {/if}
  </span>
</div>

<style>
  .dependency-actions {
    display: grid;
    grid-template-columns: repeat(2, var(--of-control-height-compact));
    flex-shrink: 0;
    --of-control-height: var(--of-control-height-compact);
  }
  .action-slot { display: flex; width: var(--of-control-height-compact); height: var(--of-control-height-compact); }
  .dependency-actions :global(.of-tooltip-trigger) { width: var(--of-control-height-compact); padding: 0; }
  .dependency-actions :global(.dependency-confirm) { color: var(--of-danger); }
</style>
