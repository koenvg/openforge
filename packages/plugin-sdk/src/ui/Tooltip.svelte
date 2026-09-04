<script lang="ts">
  import { Tooltip } from 'bits-ui'
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
    triggerClass = '',
    triggerRole,
    triggerTabindex,
    triggerTitle,
    triggerAriaDescribedby,
    onTriggerClick,
    onTriggerKeydown,
    onOpenChange,
    trigger,
  }: Props = $props()

  let triggerDescriptionIds = $derived(
    [triggerAriaDescribedby?.trim(), open ? contentId : undefined].filter(Boolean).join(' ') || undefined,
  )

  function invokeEventHandler(handler: unknown, event: MouseEvent | KeyboardEvent) {
    if (typeof handler === 'function') handler(event)
  }

  function handleTriggerClick(event: MouseEvent, internalHandler: unknown) {
    invokeEventHandler(internalHandler, event)
    if (!event.defaultPrevented) onTriggerClick?.(event)
  }

  function handleTriggerKeydown(event: KeyboardEvent, internalHandler: unknown) {
    invokeEventHandler(internalHandler, event)
    onTriggerKeydown?.(event)
    if (event.key !== 'Escape' || !open || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    open = false
    onOpenChange?.(false)
  }
</script>

<div class="of-tooltip {className ?? ''}" data-testid={testId}>
  <Tooltip.Provider {delayDuration}>
    <Tooltip.Root bind:open bind:triggerId={activeTriggerId} {disabled} {delayDuration} {onOpenChange}>
      <Tooltip.Trigger id={triggerId} {disabled}>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            class="of-tooltip-trigger {triggerClass}"
            aria-label={label}
            aria-describedby={triggerDescriptionIds}
            role={triggerRole}
            tabindex={triggerTabindex}
            title={triggerTitle}
            {disabled}
            onclick={(event) => handleTriggerClick(event, props.onclick)}
            onkeydown={(event) => handleTriggerKeydown(event, props.onkeydown)}
          >
            {@render trigger()}
          </button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content {side} {align} {sideOffset}>
          {#snippet child({ props, wrapperProps })}
            <div {...wrapperProps}>
              <div {...props} id={contentId} role="tooltip" class="of-tooltip-content">
                {content}
              </div>
            </div>
          {/snippet}
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
