<script lang="ts">
  import type { Snippet } from 'svelte'
  import { focusFirstEnabledMenuItem, isMenuNavigationKey, moveMenuFocus } from './menuNavigation'

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

  function focusFirstEnabledItem() {
    if (!visible) return
    focusFirstEnabledMenuItem(menuElement)
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

    if (isMenuNavigationKey(event.key)) {
      event.preventDefault()
      event.stopPropagation()
      moveMenuFocus(menuElement, event.key)
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
