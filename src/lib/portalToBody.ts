import type { Action } from 'svelte/action'

/**
 * Moves a node to <body> for as long as it lives. Overlays anchored inside a
 * scrolling toolbar or a CSS container need this: `overflow: hidden` clips them
 * and `container-type` makes even `position: fixed` resolve against the
 * container instead of the viewport.
 */
export const portalToBody: Action<HTMLElement, boolean | undefined> = (node, enabled = true) => {
  if (!enabled) return

  document.body.appendChild(node)
  return {
    destroy() {
      node.remove()
    },
  }
}
