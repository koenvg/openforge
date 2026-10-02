import type { StoryEnvironmentAdapter } from './storyEnvironment'

/** Pause the production SVG-mask spinner, which CSS animation suppression cannot reach. */
export function createFileViewerMotionAdapter(): StoryEnvironmentAdapter {
  const originals = new Map<HTMLElement, string>()
  let observer: MutationObserver | undefined

  function restore() {
    for (const [element, value] of originals) element.style.maskImage = value
    originals.clear()
  }
  function freeze() {
    if (document.documentElement.dataset.storybookMotion !== 'reduced') { restore(); return }
    for (const element of document.querySelectorAll<HTMLElement>('span[data-size]')) {
      if (originals.has(element)) continue
      const mask = getComputedStyle(element).maskImage
      const match = /^url\("data:image\/svg\+xml,(.*)"\)$/.exec(mask)
      if (!match) continue
      const svg = new DOMParser().parseFromString(decodeURIComponent(match[1]), 'image/svg+xml')
      const animations = svg.querySelectorAll('animate, animateTransform')
      if (!animations.length) continue
      for (const animation of animations) {
        const attribute = animation.getAttribute('attributeName')
        const value = animation.getAttribute('values')?.split(';')[1] ?? animation.getAttribute('from')
        if (attribute && value) {
          const frozen = animation.localName === 'animateTransform' ? `${animation.getAttribute('type')}(${value})` : value
          animation.parentElement?.setAttribute(attribute, frozen)
        }
        animation.remove()
      }
      originals.set(element, element.style.maskImage)
      element.style.maskImage = `url("data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}")`
    }
    for (const [element, value] of originals) {
      if (!element.isConnected) { element.style.maskImage = value; originals.delete(element) }
    }
  }
  return {
    install() {
      observer = new MutationObserver(freeze)
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-storybook-motion'] })
      freeze()
    },
    reset() { restore(); freeze() },
    dispose() { observer?.disconnect(); restore() },
  }
}
