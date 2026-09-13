<script lang="ts">
  import IconButton from './IconButton.svelte'
  import type { TooltipSide } from './Tooltip.svelte'
  import Modal from './Modal.svelte'

  let count = $state(0)
  let modalOpen = $state(false)
  const sides: TooltipSide[] = ['top', 'right', 'bottom', 'left']
  const params = new URLSearchParams(window.location.search)
  const edge = params.get('edge')
  const align = params.get('align') === 'end' ? 'end' : 'start'
  const longLabel = 'A long action label that must wrap inside a narrow window '.repeat(8)
</script>

<main>
  {#each sides as side}
    <IconButton label={`${side} action`} tooltipSide={side} tooltipSideOffset={12} onClick={() => count++}>
      <span aria-hidden="true">+</span>
    </IconButton>
  {/each}
  <output aria-label="Action count">{count}</output>
</main>

<div class="clip" style={edge ? `position:fixed; ${edge}:0;` : undefined}>
  <IconButton label={params.has('long') ? longLabel : 'Edge action'} tooltipSide={(edge ?? 'bottom') as TooltipSide} tooltipAlign={align}>
    <span aria-hidden="true">+</span>
  </IconButton>
</div>

<button onclick={() => modalOpen = true}>Open dialog</button>
{#if modalOpen}
  <Modal ariaLabel="Example dialog" onClose={() => modalOpen = false}>
    <IconButton label="Dialog action" onClick={() => count++}><span aria-hidden="true">+</span></IconButton>
  </Modal>
{/if}

<style>
  main { display: flex; gap: 100px; padding: 150px; }
  .clip { width: 36px; height: 36px; overflow: hidden; margin: 0; }
  :global(:root) {
    --of-space1: 4px; --of-space2: 8px; --of-space3: 12px;
    --of-border-width: 1px; --of-border-strong: #888;
    --of-radius-control: 6px; --of-radius-overlay: 8px;
    --of-control-height: 36px; --of-font-sans: system-ui;
    --of-text-xs: 12px; --of-line-height-xs: 1.4;
    --of-text: #222; --of-icon: #333; --of-control-hover: #eee;
    --of-surface-raised: #fff; --of-focus-width: 2px; --of-focus-ring: #245bce;
    --of-shadow-raised: 0 3px 12px #0002;
  }
</style>
