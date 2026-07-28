<script lang="ts">
  import { onMount } from 'svelte'
  import type { Snippet } from 'svelte'
  import { getFirstHTMLElementChild, getHTMLElement } from '../../../lib/domUtils'

  interface Props {
    text: string
    children: Snippet
    position?: 'bottom' | 'left'
  }

  let { text, children, position = 'bottom' }: Props = $props()

  interface AnchorRect {
    left: number
    top: number
    bottom: number
    width: number
    height: number
  }

  let visible = $state(false)
  let anchor = $state<AnchorRect | null>(null)
  let hoverTimer: ReturnType<typeof setTimeout> | null = $state(null)
  let portalEl: HTMLDivElement | null = null

  onMount(() => {
    portalEl = document.createElement('div')
    document.body.appendChild(portalEl)
    return () => {
      if (hoverTimer) {
        clearTimeout(hoverTimer)
        hoverTimer = null
      }
      portalEl?.remove()
      portalEl = null
    }
  })

  $effect(() => {
    if (!portalEl) return
    if (visible && anchor) {
      // Render hidden first so we can measure the tooltip's ACTUAL size, then
      // position it relative to the anchor and reveal — a fixed width guess
      // mis-centers short labels.
      portalEl.innerHTML = `<div style="position:fixed;left:0;top:0;z-index:9999;max-width:280px;pointer-events:none;visibility:hidden;" class="px-3 py-2 bg-base-100 border border-base-300 rounded-lg shadow-xl text-xs text-base-content/70 whitespace-pre-wrap break-words" role="tooltip"></div>`
      const inner = getFirstHTMLElementChild(portalEl)
      if (inner) {
        inner.textContent = text
        const margin = 6
        const tw = inner.offsetWidth
        const th = inner.offsetHeight
        let left: number
        let top: number
        if (position === 'left') {
          left = Math.max(8, anchor.left - tw - margin)
          top = Math.max(8, Math.min(anchor.top + anchor.height / 2 - th / 2, window.innerHeight - th - 8))
        } else {
          const centerX = anchor.left + anchor.width / 2 - tw / 2
          left = Math.max(8, Math.min(centerX, window.innerWidth - tw - 8))
          top = Math.max(8, Math.min(anchor.bottom + margin, window.innerHeight - th - 8))
        }
        inner.style.left = `${left}px`
        inner.style.top = `${top}px`
        inner.style.visibility = 'visible'
      }
    } else {
      portalEl.innerHTML = ''
    }
  })

  function show(e: MouseEvent | FocusEvent) {
    if (hoverTimer) clearTimeout(hoverTimer)

    const wrapper = getHTMLElement(e.currentTarget)
    if (!wrapper) return

    const targetElement = getFirstHTMLElementChild(wrapper) ?? wrapper

    hoverTimer = setTimeout(() => {
      const rect = targetElement.getBoundingClientRect()
      anchor = {
        left: rect.left,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }
      visible = true
    }, 200)
  }

  function hide() {
    if (hoverTimer) {
      clearTimeout(hoverTimer)
      hoverTimer = null
    }
    visible = false
  }
</script>

<div
  onmouseover={show}
  onmouseout={hide}
  onfocus={show}
  onblur={hide}
  role="group"
  class="contents"
>
  {@render children()}
</div>
