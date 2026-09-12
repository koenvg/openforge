import { tick } from 'svelte'

/** A selection highlight with the project sidebar's critically damped motion. */
export function paletteSelection(root: HTMLElement, selectedId: string | undefined) {
  const indicator = root.querySelector<HTMLElement>('[data-palette-part="selection"]')!
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  let frame: number | undefined
  let previousTime = 0
  let position = 0
  let velocity = 0
  let target = 0
  let visible = false
  let destroyed = false

  function cancel() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
  }

  function paint() {
    indicator.style.transform = `translate3d(0, ${position}px, 0)`
  }

  function settle() {
    cancel()
    position = target
    velocity = 0
    paint()
  }

  function animate(time: number) {
    const elapsed = Math.min((time - previousTime) / 1000, 0.05)
    previousTime = time
    velocity += ((target - position) * 260 - velocity * 32) * elapsed
    position += velocity * elapsed
    paint()
    if (Math.abs(target - position) < 0.1 && Math.abs(velocity) < 0.1) settle()
    else frame = requestAnimationFrame(animate)
  }

  function measure(immediate = false) {
    if (destroyed) return
    const option = Array.from(root.querySelectorAll<HTMLElement>('[role="option"]'))
      .find(element => element.id === selectedId)
    if (!option) {
      cancel()
      visible = false
      indicator.style.opacity = '0'
      return
    }
    const bounds = root.getBoundingClientRect()
    const row = option.getBoundingClientRect()
    target = row.top - bounds.top + root.scrollTop
    indicator.style.left = `${row.left - bounds.left + root.scrollLeft}px`
    indicator.style.width = `${row.width}px`
    indicator.style.height = `${row.height}px`
    indicator.style.opacity = '1'
    if (immediate || !visible || motion?.matches) settle()
    else if (frame === undefined) {
      previousTime = performance.now()
      frame = requestAnimationFrame(animate)
    }
    visible = true
  }

  const observer = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => measure(true)) : undefined
  observer?.observe(root)
  for (const option of root.querySelectorAll('[role="option"]')) observer?.observe(option)
  const mutations = new MutationObserver(() => {
    observer?.disconnect()
    observer?.observe(root)
    for (const option of root.querySelectorAll('[role="option"]')) observer?.observe(option)
    measure(true)
  })
  mutations.observe(root, { childList: true, subtree: true })
  const onMotionChange = () => { if (motion?.matches) settle() }
  motion?.addEventListener?.('change', onMotionChange)
  void tick().then(() => measure(true))

  return {
    update(id: string | undefined) {
      selectedId = id
      void tick().then(() => {
        if (destroyed) return
        measure()
      })
    },
    destroy() {
      destroyed = true
      cancel()
      observer?.disconnect()
      mutations.disconnect()
      motion?.removeEventListener?.('change', onMotionChange)
    },
  }
}
