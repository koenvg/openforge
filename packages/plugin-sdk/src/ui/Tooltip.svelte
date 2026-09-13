<script lang="ts">
  import TooltipControl from './TooltipControl.svelte'
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

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
    triggerClass?: string
    triggerRole?: HTMLButtonAttributes['role']
    triggerTabindex?: number
    triggerTitle?: string
    triggerAriaDescribedby?: string
    onTriggerClick?: (event: MouseEvent) => void
    onTriggerKeydown?: (event: KeyboardEvent) => void
    onOpenChange?: (open: boolean) => void
    trigger: Snippet
  }

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
    triggerClass = '',
    triggerRole,
    triggerTabindex,
    triggerTitle,
    triggerAriaDescribedby,
    onTriggerClick,
    onTriggerKeydown,
    onOpenChange,
    trigger: renderTrigger,
  }: Props = $props()
</script>

<div class="of-tooltip {className ?? ''}" data-testid={testId}>
  <TooltipControl
    ignoreNonKeyboardFocus={false}
    {content}
    bind:open
    {disabled}
    {delayDuration}
    {side}
    {align}
    {sideOffset}
    {onOpenChange}
    triggerAttributes={{
      type: 'button',
      class: `of-tooltip-trigger ${triggerClass}`,
      'aria-label': label,
      'aria-describedby': triggerAriaDescribedby,
      role: triggerRole,
      tabindex: triggerTabindex,
      title: triggerTitle,
      disabled,
      onclick: onTriggerClick,
      onkeydown: onTriggerKeydown,
    }}
  >
    {#snippet trigger(props)}
      <button {...props}>{@render renderTrigger()}</button>
    {/snippet}
  </TooltipControl>
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

  @media (prefers-reduced-motion: reduce) {
    .of-tooltip :global(.of-tooltip-trigger) {
      transition: none;
    }
  }
</style>
