<script lang="ts">
  import Tabs from '@openforge-app/plugin-sdk/ui/Tabs.svelte'

  interface Props {
    disabled?: boolean
    fill?: boolean
    onValueChange?: (value: string) => void
  }

  let { disabled = false, fill = false, onValueChange }: Props = $props()
  let value = $state('overview')
  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'disabled', label: 'Unavailable', disabled: true },
    { value: 'activity', label: 'Activity' },
  ]
</script>

<button type="button" onclick={() => (value = 'activity')}>Show activity</button>
<Tabs label="Project sections" {tabs} {disabled} {fill} bind:value {onValueChange}>
  {#snippet children(tabValue)}
    {#if tabValue === 'overview'}
      <p>Overview panel</p>
    {:else if tabValue === 'activity'}
      <p>Activity panel</p>
    {:else}
      <p>Unavailable panel</p>
    {/if}
  {/snippet}
</Tabs>
