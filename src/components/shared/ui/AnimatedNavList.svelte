<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import type { Snippet } from 'svelte'

  export type AnimatedNavItemAction = (node: HTMLElement, id: string) => {
    update?: (id: string) => void
    destroy?: () => void
  }

  interface Props {
    activeId: string | null
    children: Snippet<[registerItem: AnimatedNavItemAction]>
    followHover?: boolean
    class?: string
  }

  type Frame = {
    x: number
    y: number
    width: number
    height: number
  }

  let {
    activeId,
    children,
    followHover = true,
    class: className,
  }: Props = $props()

  let rootElement = $state<HTMLElement | null>(null)
  let indicatorElement = $state<HTMLSpanElement | null>(null)
  let hoveredId = $state<string | null>(null)
  let reducedMotion = $state(false)

  const items = new Map<string, HTMLElement>()
  let resizeObserver: ResizeObserver | null = null
  let animationFrame: number | null = null
  let lastAnimationTime = 0
  let hasPosition = false
  let indicatorVisible = false
  let position = { x: 0, y: 0 }
  let velocity = { x: 0, y: 0 }
  let targetPosition = { x: 0, y: 0 }

  function cancelAnimation() {
    if (animationFrame === null) return
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }

  function writePosition() {
    if (!indicatorElement) return
    indicatorElement.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`
  }

  function settlePosition() {
    cancelAnimation()
    position = { ...targetPosition }
    velocity = { x: 0, y: 0 }
    writePosition()
  }

  function animatePosition(timestamp: number) {
    if (!indicatorElement) {
      animationFrame = null
      return
    }

    const elapsed = Math.min((timestamp - lastAnimationTime) / 1000, 0.05)
    lastAnimationTime = timestamp

    // Critically damped spring: quick enough for list navigation, without the
    // overshoot that makes a compact sidebar feel loose or imprecise.
    const stiffness = 260
    const damping = 32
    velocity.x += ((targetPosition.x - position.x) * stiffness - velocity.x * damping) * elapsed
    velocity.y += ((targetPosition.y - position.y) * stiffness - velocity.y * damping) * elapsed
    position.x += velocity.x * elapsed
    position.y += velocity.y * elapsed
    writePosition()

    const settled = Math.abs(targetPosition.x - position.x) < 0.1
      && Math.abs(targetPosition.y - position.y) < 0.1
      && Math.abs(velocity.x) < 0.1
      && Math.abs(velocity.y) < 0.1

    if (settled) {
      settlePosition()
      return
    }

    animationFrame = requestAnimationFrame(animatePosition)
  }

  function startAnimation() {
    if (animationFrame !== null) return
    lastAnimationTime = performance.now()
    animationFrame = requestAnimationFrame(animatePosition)
  }

  function frameFor(id: string): Frame | null {
    const root = rootElement
    const node = items.get(id)
    if (!root || !node) return null

    const rootRect = root.getBoundingClientRect()
    const nodeRect = node.getBoundingClientRect()
    return {
      x: nodeRect.left - rootRect.left + root.scrollLeft,
      y: nodeRect.top - rootRect.top + root.scrollTop,
      width: nodeRect.width,
      height: nodeRect.height,
    }
  }

  function hideIndicator() {
    cancelAnimation()
    indicatorVisible = false
    if (indicatorElement) indicatorElement.style.opacity = '0'
  }

  function moveTo(id: string | null, immediate = false) {
    if (!id) {
      hideIndicator()
      return
    }

    const frame = frameFor(id)
    if (!frame || !indicatorElement) {
      hideIndicator()
      return
    }

    targetPosition = { x: frame.x, y: frame.y }
    indicatorElement.style.width = `${frame.width}px`
    indicatorElement.style.height = `${frame.height}px`
    indicatorElement.style.opacity = '1'

    const shouldJump = immediate || reducedMotion || !hasPosition || !indicatorVisible
    if (shouldJump) {
      hasPosition = true
      indicatorVisible = true
      settlePosition()
      return
    }

    indicatorVisible = true
    startAnimation()
  }

  function measureAll(immediate = true) {
    const currentId = hoveredId ?? activeId
    if (!rootElement || !indicatorElement) return
    moveTo(currentId, immediate)
  }

  function setHovered(id: string) {
    if (!followHover) return
    hoveredId = id
    moveTo(id)
  }

  function clearHovered() {
    if (!followHover) return
    hoveredId = null
    moveTo(activeId)
  }

  function handleFocusOut(event: FocusEvent) {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && rootElement?.contains(nextTarget)) return
    clearHovered()
  }

  const registerItem: AnimatedNavItemAction = (node, id) => {
    let registeredId = id
    const enter = () => setHovered(registeredId)

    items.set(registeredId, node)
    node.addEventListener('pointerenter', enter)
    node.addEventListener('focusin', enter)
    if (resizeObserver) resizeObserver.observe(node)
    void tick().then(() => measureAll(true))

    return {
      update(nextId: string) {
        if (nextId === registeredId) return
        items.delete(registeredId)
        registeredId = nextId
        items.set(registeredId, node)
        void tick().then(() => measureAll(true))
      },
      destroy() {
        node.removeEventListener('pointerenter', enter)
        node.removeEventListener('focusin', enter)
        if (items.get(registeredId) === node) items.delete(registeredId)
        resizeObserver?.unobserve(node)
      },
    }
  }

  onMount(() => {
    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    reducedMotion = mediaQuery?.matches ?? false
    const handleMotionPreferenceChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches
      if (reducedMotion) settlePosition()
    }
    mediaQuery?.addEventListener?.('change', handleMotionPreferenceChange)

    if (typeof ResizeObserver === 'function' && rootElement) {
      resizeObserver = new ResizeObserver(() => measureAll(true))
      resizeObserver.observe(rootElement)
      for (const node of items.values()) resizeObserver.observe(node)
    }

    void tick().then(() => measureAll(true))

    return () => {
      mediaQuery?.removeEventListener?.('change', handleMotionPreferenceChange)
      resizeObserver?.disconnect()
      resizeObserver = null
      cancelAnimation()
    }
  })

  onDestroy(() => {
    // Keep teardown explicit for the animation and per-item listeners. The
    // action lifecycle above owns individual rows; this handles root teardown.
    cancelAnimation()
    items.clear()
  })

  $effect(() => {
    const currentId = activeId
    void tick().then(() => {
      if (hoveredId === null) moveTo(currentId)
    })
  })
</script>

<div
  bind:this={rootElement}
  class="animated-nav-list"
  data-animated-nav-list
  role="presentation"
  onpointerleave={clearHovered}
  onfocusout={handleFocusOut}
>
  <span
    bind:this={indicatorElement}
    data-animated-nav-indicator
    aria-hidden="true"
    class="animated-nav-indicator"
  ></span>
  <div class="animated-nav-list-items {className ?? ''}">
    {@render children(registerItem)}
  </div>
</div>

<style>
  .animated-nav-list {
    position: relative;
    isolation: isolate;
  }

  .animated-nav-list-items {
    position: relative;
    z-index: 1;
  }

  .animated-nav-indicator {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 0;
    border-radius: var(--of-radius-control);
    background: var(--of-accent-subtle);
    pointer-events: none;
    opacity: 0;
    will-change: transform, opacity;
    transition:
      width var(--of-duration-fast) var(--of-ease-standard),
      height var(--of-duration-fast) var(--of-ease-standard),
      opacity var(--of-duration-fast) var(--of-ease-standard);
  }

  @media (prefers-reduced-motion: reduce) {
    .animated-nav-indicator {
      transition: none;
    }
  }
</style>
