<script lang="ts">
  import { tick, type Snippet } from 'svelte'
  import { portalToBody } from '../../../lib/portalToBody'

  interface Props {
    visible: boolean
    trigger: HTMLElement | null
    onClose: () => void
    id?: string
    placementClass?: string
    /**
     * Move the menu to <body> and pin it under the trigger's viewport rect.
     * Needed when an ancestor clips overflow or is a CSS container.
     */
    detached?: boolean
    children: Snippet
  }

  let {
    visible,
    trigger,
    onClose,
    id,
    placementClass = 'top-[calc(100%+4px)] right-0',
    detached = false,
    children,
  }: Props = $props()

  const TRIGGER_GAP_PX = 4

  let menuRef = $state<HTMLDivElement | null>(null)
  let anchor = $state<{ top: number; right: number } | null>(null)

  let positionClass = $derived(detached ? 'fixed' : `absolute ${placementClass}`)
  let positionStyle = $derived(
    anchor === null ? undefined : `top: ${anchor.top}px; right: ${anchor.right}px`,
  )

  function measureAnchor() {
    if (!detached) return
    const rect = trigger?.getBoundingClientRect()
    anchor = rect
      ? { top: rect.bottom + TRIGGER_GAP_PX, right: window.innerWidth - rect.right }
      : null
  }

  async function focusFirstEnabledItem() {
    await tick()
    if (!visible) return
    const firstItem = menuRef?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled]):not([aria-disabled="true"])')
    firstItem?.focus()
  }

  function closeAndRestoreFocus() {
    onClose()
    void tick().then(() => trigger?.focus())
  }

  function handlePointerDown(event: PointerEvent) {
    if (!visible || !(event.target instanceof Node)) return
    if (menuRef?.contains(event.target) || trigger?.contains(event.target)) return
    closeAndRestoreFocus()
  }

  function handleReflow() {
    if (visible) measureAnchor()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closeAndRestoreFocus()
  }

  $effect(() => {
    if (!visible) return
    measureAnchor()
    void focusFirstEnabledItem()
  })
</script>

<svelte:window onpointerdown={handlePointerDown} onresize={handleReflow} onscrollcapture={handleReflow} />

{#if visible}
  <div
    bind:this={menuRef}
    use:portalToBody={detached}
    {id}
    role="menu"
    tabindex="-1"
    class="{positionClass} z-[100] min-w-[180px] overflow-hidden rounded-lg border border-base-300 bg-base-200 p-1 shadow-lg"
    style={positionStyle}
    onkeydown={handleKeydown}
  >
    {@render children()}
  </div>
{/if}
