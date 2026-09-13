<script lang="ts">
  import { Tooltip } from 'bits-ui'
  import { flushSync, untrack, type Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import type { TooltipAlign, TooltipSide } from './Tooltip.svelte'

  interface Props {
    content: string
    open?: boolean
    disabled?: boolean
    ignoreNonKeyboardFocus?: boolean
    delayDuration?: number
    side?: TooltipSide
    align?: TooltipAlign
    sideOffset?: number
    triggerAttributes?: HTMLButtonAttributes
    onOpenChange?: (open: boolean) => void
    trigger: Snippet<[HTMLButtonAttributes]>
  }

  const generatedId = $props.id()
  const contentId = `of-tooltip-content-${generatedId}`
  let {
    content,
    open = $bindable(false),
    disabled = false,
    ignoreNonKeyboardFocus = true,
    delayDuration = 300,
    side = 'top',
    align = 'center',
    sideOffset = 6,
    triggerAttributes = {},
    onOpenChange,
    trigger,
  }: Props = $props()

  // Bits UI reads trigger props while unregistering it. Snapshot them while
  // mounted so teardown never reevaluates getters on a disposed host controller.
  let currentAttributes = $state.raw<HTMLButtonAttributes>(untrack(() => ({ ...triggerAttributes })))
  $effect.pre(() => { currentAttributes = { ...triggerAttributes } })

  $effect(() => {
    if (open && disabled) {
      open = false
      onOpenChange?.(false)
    }
  })

  const triggerId = $derived(currentAttributes.id ?? `of-tooltip-trigger-${generatedId}`)
  let activeTriggerId = $state<string | null>(untrack(() => triggerId))
  const descriptionIds = $derived(
    [currentAttributes['aria-describedby']?.trim(), open ? contentId : undefined]
      .filter(Boolean).join(' ') || undefined,
  )

  function handleOverlayKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !event.defaultPrevented && document.activeElement?.id !== triggerId) {
      // A hovered tooltip may have focus elsewhere in its dialog. Consume Escape
      // before that dialog handles it; focused triggers keep their own handler.
      event.preventDefault()
      event.stopPropagation()
      open = false
      onOpenChange?.(false)
      return
    }
    if (event.key !== 'Tab' || event.defaultPrevented) return
    // Release the tooltip's non-trapping focus scope before the containing
    // dialog handles Tab. Otherwise Bits UI pauses the dialog's focus loop.
    flushSync(() => {
      open = false
      onOpenChange?.(false)
    })
  }

  function handleKeydown(event: KeyboardEvent, handler: unknown) {
    if (typeof handler === 'function') handler(event)
    if (event.key !== 'Escape' || !open || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    open = false
    onOpenChange?.(false)
  }

  function handleClick(event: MouseEvent, handler: unknown) {
    if (typeof handler === 'function') handler(event)
    // Dismiss even when a consumer cancels the button's default action.
    if (!open) return
    open = false
    onOpenChange?.(false)
  }
</script>

<svelte:window onkeydowncapture={open ? handleOverlayKeydown : undefined} />

<Tooltip.Provider {delayDuration}>
  <Tooltip.Root bind:open bind:triggerId={activeTriggerId} {disabled} {delayDuration} {ignoreNonKeyboardFocus} {onOpenChange}>
    <Tooltip.Trigger {...currentAttributes} id={triggerId}>
      {#snippet child({ props })}
        {@render trigger({
          ...props,
          'aria-describedby': descriptionIds,
          onkeydown: (event) => handleKeydown(event, props.onkeydown),
          onclick: (event) => handleClick(event, props.onclick),
        })}
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content id={contentId} {side} {align} {sideOffset} collisionPadding={8} onEscapeKeydown={(event) => event.stopPropagation()}>
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

<style>
  :global(.of-tooltip-content) {
    z-index: 1200;
    box-sizing: border-box;
    max-width: min(20rem, calc(100vw - 16px));
    overflow-wrap: anywhere;
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

  :global(.of-tooltip-content) {
    --tooltip-x: 0px;
    --tooltip-y: 0px;
    transform-origin: var(--bits-tooltip-content-transform-origin);
  }

  :global(.of-tooltip-content[data-side='top']) { --tooltip-y: 3px; }
  :global(.of-tooltip-content[data-side='bottom']) { --tooltip-y: -3px; }
  :global(.of-tooltip-content[data-side='left']) { --tooltip-x: 3px; }
  :global(.of-tooltip-content[data-side='right']) { --tooltip-x: -3px; }

  :global(.of-tooltip-content[data-state='delayed-open']),
  :global(.of-tooltip-content[data-state='instant-open']) {
    animation: tooltip-enter 200ms ease-out;
  }

  :global(.of-tooltip-content[data-state='closed']) {
    animation: tooltip-exit 100ms ease-in;
    pointer-events: none;
  }

  @keyframes tooltip-enter {
    from { opacity: 0; transform: translate(var(--tooltip-x), var(--tooltip-y)) scale(0.96); }
    65% { opacity: 1; transform: translate(calc(var(--tooltip-x) / -3), calc(var(--tooltip-y) / -3)) scale(1.02); }
    to { opacity: 1; transform: translate(0, 0) scale(1); }
  }

  @keyframes tooltip-exit {
    from { opacity: 1; }
    to { opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.of-tooltip-content[data-state]) { animation: none; }
  }
</style>
