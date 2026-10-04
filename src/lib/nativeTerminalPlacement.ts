import type { NativeTerminalBounds } from '../electron/nativeTerminalProtocol'

/** DOM owns layout; native views have no DOM clipping or z-order awareness. */
export class NativeTerminalPlacement {
  private stop: (() => void) | null = null
  private frame = 0

  constructor(readonly element: HTMLElement, private readonly changed: () => void) {}

  read(visible: boolean): NativeTerminalBounds {
    const rect = this.element.getBoundingClientRect()
    const overlays = document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"], [role="tooltip"], dialog[open], [popover]')
    const obscured = Array.from(overlays).some(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
    let hidden = !!this.element.closest('[hidden], [aria-hidden="true"], [inert]')
    for (let element: HTMLElement | null = this.element; element && !hidden; element = element.parentElement) {
      const style = getComputedStyle(element)
      hidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0'
    }
    // Retained panes can cover the terminal without changing its own dimensions.
    const points = [[rect.left + 1, rect.top + 1], [rect.right - 1, rect.top + 1], [rect.left + 1, rect.bottom - 1], [rect.right - 1, rect.bottom - 1], [rect.x + rect.width / 2, rect.y + rect.height / 2]]
    const covered = typeof document.elementFromPoint === 'function' && points.some(([x, y]) => {
      const hit = document.elementFromPoint(x, y)
      return !hit || !this.element.contains(hit)
    })
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: visible && this.element.isConnected && document.visibilityState !== 'hidden' && !obscured && !hidden && !covered }
  }

  observe(): void {
    this.disconnect()
    const schedule = () => {
      if (this.frame) return
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.changed() })
    }
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'open', 'aria-hidden'] })
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    document.addEventListener('visibilitychange', schedule)
    this.stop = () => {
      mutations.disconnect()
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('visibilitychange', schedule)
    }
  }

  disconnect(): void {
    this.stop?.()
    this.stop = null
    cancelAnimationFrame(this.frame)
    this.frame = 0
  }
}
