<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    visible: boolean
    x: number
    y: number
    onClose: () => void
    children: Snippet
  }

  let { visible, x, y, onClose, children }: Props = $props()

  let menuElement: HTMLDivElement | null = $state(null)
  let returnFocusTarget: HTMLElement | null = null

  function getEnabledItems(): HTMLElement[] {
    if (!menuElement) return []

    return Array.from(
      menuElement.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]):not([aria-disabled="true"])'),
    )
  }

  function focusFirstEnabledItem() {
    if (!visible) return

    const [firstItem] = getEnabledItems()
    const focusTarget = firstItem ?? menuElement
    focusTarget?.focus()
  }

  function moveFocus(key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End') {
    const items = getEnabledItems()
    if (items.length === 0) {
      menuElement?.focus()
      return
    }

    if (key === 'Home') {
      items[0].focus()
      return
    }

    if (key === 'End') {
      items[items.length - 1].focus()
      return
    }

    const currentIndex = items.indexOf(document.activeElement as HTMLElement)
    const offset = key === 'ArrowDown' ? 1 : -1
    const nextIndex = currentIndex === -1
      ? (offset === 1 ? 0 : items.length - 1)
      : (currentIndex + offset + items.length) % items.length
    items[nextIndex].focus()
  }

  function closeAndRestoreFocus() {
    const target = returnFocusTarget
    onClose()
    if (target?.isConnected) target.focus()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault()
      event.stopPropagation()
      closeAndRestoreFocus()
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      moveFocus(event.key)
    }
  }

  $effect(() => {
    if (!visible) return

    returnFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
    focusFirstEnabledItem()
  })
</script>

<svelte:window onclick={onClose} />

{#if visible}
  <div
    bind:this={menuElement}
    class="fixed z-[100] bg-base-300 border border-base-300 rounded-lg shadow-xl min-w-[180px] p-1"
    style="left: {x}px; top: {y}px;"
    role="menu"
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    {@render children()}
  </div>
{/if}
