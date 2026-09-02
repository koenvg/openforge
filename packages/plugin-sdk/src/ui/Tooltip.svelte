<script lang="ts">
  import { Tooltip } from 'bits-ui'
  import type { Snippet } from 'svelte'

  export type TooltipSide = 'top' | 'right' | 'bottom' | 'left'
  export type TooltipAlign = 'start' | 'center' | 'end'

  interface Props {
    label: string
    content: string
    open?: boolean
    disabled?: boolean
    delayDuration?: number
    side?: TooltipSide
    align?: TooltipAlign
    sideOffset?: number
    class?: string
    testId?: string
    onOpenChange?: (open: boolean) => void
    trigger: Snippet
  }


  const generatedId = $props.id()
  const triggerId = `of-tooltip-trigger-${generatedId}`
  const contentId = `of-tooltip-content-${generatedId}`
  let activeTriggerId = $state<string | null>(triggerId)
  let {
    label,
    content,
    open = $bindable(false),
    disabled = false,
    delayDuration = 300,
    side = 'top',
    align = 'center',
    sideOffset = 6,
    class: className,
    testId,
    onOpenChange,
    trigger,
  }: Props = $props()
</script>

<div class="of-tooltip {className ?? ''}" data-testid={testId}>
  <Tooltip.Provider {delayDuration}>
    <Tooltip.Root bind:open bind:triggerId={activeTriggerId} {disabled} {delayDuration} {onOpenChange}>
      <Tooltip.Trigger id={triggerId} class="of-tooltip-trigger" aria-label={label} aria-describedby={open ? contentId : undefined} {disabled}>
        {@render trigger()}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content id={contentId} role="tooltip" class="of-tooltip-content" {side} {align} {sideOffset}>
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
</div>

<style>
  .of-tooltip {
    display: inline-flex;
    color: var(--of-text);
    font-family: var(--of-font-sans);
  }

  .of-tooltip :global(.of-tooltip-trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--of-control-height);
    padding: 0 var(--of-space3);
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-control);
    background: var(--of-control);
    color: var(--of-control-text);
    font: inherit;
    cursor: pointer;
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard);
  }

  .of-tooltip :global(.of-tooltip-trigger:hover:not(:disabled)) {
    background: var(--of-control-hover);
  }

  .of-tooltip :global(.of-tooltip-trigger:focus-visible) {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  .of-tooltip :global(.of-tooltip-trigger:disabled) {
    background: var(--of-control-disabled);
    color: var(--of-control-text-disabled);
    cursor: not-allowed;
  }

  :global(.of-tooltip-content) {
    z-index: 1200;
    max-width: 20rem;
    padding: var(--of-space2) var(--of-space3);
    border: var(--of-border-width) solid var(--of-border-strong);
    border-radius: var(--of-radius-overlay);
    background: var(--of-surface-raised);
    color: var(--of-text);
    box-shadow: var(--of-shadow-raised);
    font-family: var(--of-font-sans);
    font-size: var(--of-text-xs);
    line-height: var(--of-line-height-xs);
  }

  @media (prefers-reduced-motion: reduce) {
    .of-tooltip :global(.of-tooltip-trigger) {
      transition: none;
    }
  }
</style>
