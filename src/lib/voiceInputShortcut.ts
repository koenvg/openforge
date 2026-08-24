export interface VoiceInputShortcutTarget {
  root: HTMLElement
  isEnabled: () => boolean
  toggle: () => void
}

const targets: VoiceInputShortcutTarget[] = []

export function registerVoiceInputShortcutTarget(target: VoiceInputShortcutTarget): () => void {
  targets.push(target)

  return () => {
    const index = targets.indexOf(target)
    if (index !== -1) targets.splice(index, 1)
  }
}

function isVisible(element: HTMLElement): boolean {
  let current: HTMLElement | null = element

  while (current) {
    const style = window.getComputedStyle(current)
    if (current.hidden
      || style.display === 'none'
      || style.visibility === 'hidden'
      || style.visibility === 'collapse'
      || style.contentVisibility === 'hidden'
      || style.opacity === '0'
    ) return false

    current = current.parentElement
  }

  return true
}

export function toggleVoiceInputShortcut(): boolean {
  const openModals = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
  const topmostModal = openModals.item(openModals.length - 1)

  const activeElement = document.activeElement
  const orderedTargets = targets.slice().reverse()
  const isEligible = (candidate: VoiceInputShortcutTarget) => candidate.root.isConnected
    && isVisible(candidate.root)
    && candidate.isEnabled()
    && (!topmostModal || topmostModal.contains(candidate.root))
  const target = orderedTargets.find((candidate) =>
    isEligible(candidate) && activeElement instanceof Node && candidate.root.contains(activeElement)
  ) ?? orderedTargets.find(isEligible)
  if (!target) return false

  target.toggle()
  return true
}
