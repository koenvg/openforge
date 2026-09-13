<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import SplitButton from '@openforge-app/plugin-sdk/ui/SplitButton.svelte'

  let { state: scenario = 'default' }: { state?: 'default' | 'edge' | 'unavailable' | 'opt-out' | 'dialog' | 'menu' } = $props()
  let dialogOpen = $state(false)
  let count = $state(0)
</script>

<div class="tooltip-story">
  <h2>Icon-button tooltips</h2>
  {#if scenario === 'edge'}
    <div class="edge">
      <IconButton label="Open a very long repository action label that wraps without clipping at the window edge" tooltipSide="left">↗</IconButton>
    </div>
  {:else if scenario === 'unavailable'}
    <IconButton label="Disabled action" disabled>+</IconButton>
    <IconButton label="Loading action" loading>+</IconButton>
  {:else if scenario === 'opt-out'}
    <IconButton label="Action without tooltip" tooltip={false}>+</IconButton>
  {:else if scenario === 'dialog'}
    <Button onClick={() => dialogOpen = true}>Open dialog</Button>
    {#if dialogOpen}
      <Modal ariaLabel="Tooltip example" onClose={() => dialogOpen = false}>
        <IconButton label="Dialog action" onClick={() => count++}>+</IconButton>
      </Modal>
    {/if}
  {:else if scenario === 'menu'}
    <SplitButton menuLabel="More actions" items={[{ value: 'retry', label: 'Retry' }]} onSelect={() => count++} onClick={() => count++}>Run</SplitButton>
  {:else}
    <div class="toolbar" role="toolbar" aria-label="Tooltip examples">
      {#each ['top', 'right', 'bottom', 'left'] as const as side}
        <IconButton label={`${side} action`} tooltipSide={side} onClick={() => count++}>+</IconButton>
      {/each}
      <Button aria-label="Run app locally" tooltip tooltipAlign="start" tooltipSideOffset={10} onClick={() => count++}>Run app</Button>
    </div>
  {/if}
  <output aria-label="Action count">{count}</output>
</div>

<style>
  .tooltip-story { padding: 64px; color: var(--of-text); font-family: var(--of-font-sans); }
  h2 { margin-bottom: 40px; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 24px; max-height: 80px; overflow: auto; padding: 8px; }
  .edge { position: fixed; top: 4px; left: 4px; }
  output { display: block; margin-top: 24px; }
</style>
