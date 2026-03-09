import { isInputFocused } from './domUtils'

export interface VimNavigationCallbacks {
  /** Total number of items in the current list */
  getItemCount: () => number
  /** Called when Enter is pressed on the focused item */
  onSelect?: (index: number) => void
  /** Called when Escape or q is pressed */
  onBack?: () => void
  /** Called when x is pressed on the focused item */
  onAction?: (index: number) => void
  /** Called when h is pressed (move left / previous column) */
  onLeft?: () => void
  /** Called when l is pressed (move right / next column) */
  onRight?: () => void
}

export interface VimNavigationState {
  readonly focusedIndex: number
  setFocusedIndex: (index: number) => void
  handleKeydown: (e: KeyboardEvent) => void
}

/**
 * Reusable Svelte 5 composable for vim-style j/k/G/gg/Enter/Escape/q/x/h/l navigation.
 * Returns reactive focusedIndex and a keydown handler to wire into svelte:window or element.
 */
export function useVimNavigation(callbacks: VimNavigationCallbacks): VimNavigationState {
  let focusedIndex = $state(0)
  let pendingG = $state(false)
  let gTimer: ReturnType<typeof setTimeout> | null = null

  function clearPendingG() {
    pendingG = false
    if (gTimer) {
      clearTimeout(gTimer)
      gTimer = null
    }
  }

  function clampIndex(index: number): number {
    const count = callbacks.getItemCount()
    if (count === 0) return 0
    return Math.max(0, Math.min(index, count - 1))
  }

  function handleKeydown(e: KeyboardEvent) {
    if (isInputFocused()) return
    if (e.metaKey || e.ctrlKey || e.altKey) return

    const count = callbacks.getItemCount()

    // Handle pending g sequence
    if (pendingG) {
      clearPendingG()
      if (e.key === 'g') {
        // gg → jump to first item
        e.preventDefault()
        focusedIndex = 0
        return
      }
      // Not a recognized g-sequence for this composable, let it propagate
      return
    }

    switch (e.key) {
      case 'j':
        e.preventDefault()
        if (count > 0) {
          focusedIndex = clampIndex(focusedIndex + 1)
        }
        break

      case 'k':
        e.preventDefault()
        if (count > 0) {
          focusedIndex = clampIndex(focusedIndex - 1)
        }
        break

      case 'G':
        e.preventDefault()
        if (count > 0) {
          focusedIndex = count - 1
        }
        break

      case 'g':
        e.preventDefault()
        pendingG = true
        gTimer = setTimeout(clearPendingG, 500)
        break

      case 'Enter':
        if (count > 0 && callbacks.onSelect) {
          e.preventDefault()
          callbacks.onSelect(focusedIndex)
        }
        break

      case 'Escape':
        if (callbacks.onBack) {
          e.preventDefault()
          callbacks.onBack()
        }
        break

      case 'q':
        if (callbacks.onBack) {
          e.preventDefault()
          callbacks.onBack()
        }
        break

      case 'x':
        if (count > 0 && callbacks.onAction) {
          e.preventDefault()
          callbacks.onAction(focusedIndex)
        }
        break

      case 'h':
        if (callbacks.onLeft) {
          e.preventDefault()
          callbacks.onLeft()
        }
        break

      case 'l':
        if (callbacks.onRight) {
          e.preventDefault()
          callbacks.onRight()
        }
        break
    }
  }

  function setFocusedIndex(index: number) {
    focusedIndex = clampIndex(index)
  }

  return {
    get focusedIndex() { return focusedIndex },
    setFocusedIndex,
    handleKeydown,
  }
}
