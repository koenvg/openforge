<script lang="ts">
  import Tooltip from '@openforge-app/plugin-sdk/ui/Tooltip.svelte'

  interface Props {
    disabled?: boolean
    onOpenChange?: (open: boolean) => void
  }

  let { disabled = false, onOpenChange }: Props = $props()
  let open = $state(false)
</script>

<button type="button" onclick={() => (open = true)}>Show help externally</button>
<Tooltip
  label="Review status help"
  content="Shows whether review is required"
  delayDuration={0}
  {disabled}
  bind:open
  {onOpenChange}
>
  {#snippet trigger()}
    Help
  {/snippet}
</Tooltip>
