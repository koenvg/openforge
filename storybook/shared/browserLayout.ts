/**
 * Read resting layout inside Locator.evaluate(measureBrowserLayout).
 * This callback must be self-contained for Playwright serialization. It never
 * focuses, scrolls, clicks, or asserts; callers own interactions and tolerances.
 * Clip limits intersect the viewport with overflow ancestors' bounding boxes,
 * not client boxes, matching the native Storybook regression checks.
 */
export function measureBrowserLayout(element: Element) {
  const rect = element.getBoundingClientRect()
  let clipLeft = 0
  let clipRight = window.innerWidth
  let clipTop = 0
  let clipBottom = window.innerHeight
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    const bounds = parent.getBoundingClientRect()
    if (style.overflowX !== 'visible') {
      clipLeft = Math.max(clipLeft, bounds.left)
      clipRight = Math.min(clipRight, bounds.right)
    }
    if (style.overflowY !== 'visible') {
      clipTop = Math.max(clipTop, bounds.top)
      clipBottom = Math.min(clipBottom, bounds.bottom)
    }
  }
  return {
    label: element.getAttribute('aria-label') ?? element.textContent,
    left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
    width: rect.width, height: rect.height,
    clipLeft, clipRight, clipTop, clipBottom,
    clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
  }
}
