<script lang="ts">
  import { tick, type Snippet } from 'svelte'
  import { portalToBody } from '../../../lib/portalToBody'
  import {
    focusFirstEnabledMenuItem,
    getEnabledMenuItems,
    isMenuNavigationKey,
    moveMenuFocus,
  } from './menuNavigation'

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
  let lastFocusedIndex = 0
  let lastFocusedItem: HTMLElement | null = null

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
    focusFirstEnabledMenuItem(menuRef)
  }

  function handleFocusIn(event: FocusEvent) {
    if (!(event.target instanceof HTMLElement)) return
    const items = getEnabledMenuItems(menuRef)
    const focusedIndex = items.indexOf(event.target)
    if (focusedIndex === -1) return
    lastFocusedIndex = focusedIndex
    lastFocusedItem = event.target
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
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeAndRestoreFocus()
      return
    }

    if (!isMenuNavigationKey(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    moveMenuFocus(menuRef, event.key)
  }

  $effect(() => {
    if (!visible) return
    measureAnchor()
    void focusFirstEnabledItem()
  })

  $effect(() => {
    if (!visible || !menuRef) return
    const observedMenu = menuRef
    const observer = new MutationObserver(() => {
      if (observedMenu.contains(document.activeElement)) return
      if (lastFocusedItem?.isConnected) return

      const items = getEnabledMenuItems(observedMenu)
      const nextIndex = Math.min(lastFocusedIndex, Math.max(items.length - 1, 0))
      const focusTarget = items[nextIndex] ?? observedMenu
      focusTarget.focus()
    })

    observer.observe(observedMenu, { childList: true, subtree: true })
    return () => observer.disconnect()
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
    onfocusin={handleFocusIn}
  >
    {@render children()}
  </div>
{/if}
