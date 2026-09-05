<script lang="ts">
  import Tooltip from '@openforge-app/plugin-sdk/ui/Tooltip.svelte'

  interface Props {
    disabled?: boolean
    menuItem?: boolean
    existingDescription?: boolean
    onActivate?: (event: MouseEvent) => void
    onOpenChange?: (open: boolean) => void
  }

  let { disabled = false, menuItem = false, existingDescription = false, onActivate, onOpenChange }: Props = $props()
  let open = $state(false)
</script>

<button type="button" onclick={() => (open = true)}>Show help externally</button>
{#if existingDescription}<span id="persistent-trigger-help">Persistent help</span>{/if}
<Tooltip
  label="Review status help"
  content="Shows whether review is required"
  delayDuration={0}
  {disabled}
  triggerRole={menuItem ? 'menuitem' : undefined}
  triggerTabindex={menuItem ? -1 : undefined}
  triggerAriaDescribedby={existingDescription ? 'persistent-trigger-help' : undefined}
  onTriggerClick={onActivate}
  bind:open
  {onOpenChange}
>
  {#snippet trigger()}
    Help
  {/snippet}
</Tooltip>
