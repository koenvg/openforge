<script lang="ts">
  import Tabs from '@openforge-app/plugin-sdk/ui/Tabs.svelte'

  interface Props {
    disabled?: boolean
    fill?: boolean
    attached?: boolean
    withActivitySignal?: boolean
    onValueChange?: (value: string) => void
  }

  let {
    disabled = false,
    fill = false,
    attached = false,
    withActivitySignal = false,
    onValueChange,
  }: Props = $props()
  let value = $state('overview')
</script>

{#snippet activitySignal()}<span data-testid="activity-signal">New</span>{/snippet}
{#snippet settingsIcon()}<span data-testid="settings-icon">Settings icon</span>{/snippet}

<button type="button" onclick={() => (value = 'activity')}>Show activity</button>
<Tabs
  label="Project sections"
  tabs={[
    { value: 'overview', label: 'Overview' },
    { value: 'disabled', label: 'Unavailable', disabled: true },
    {
      value: 'activity',
      label: 'Activity',
      ariaLabel: withActivitySignal ? 'Activity, unread output' : undefined,
      trailing: withActivitySignal ? activitySignal : undefined,
    },
    { value: 'settings', label: 'Settings', icon: settingsIcon },
  ]}
  {disabled}
  {fill}
  {attached}
  bind:value
  {onValueChange}
>
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
