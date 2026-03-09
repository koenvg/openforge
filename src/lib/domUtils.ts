/** Check if the currently focused element is an input, textarea, or contenteditable */
export function isInputFocused(): boolean {
  const active = document.activeElement
  if (!active) return false
  const tagName = active.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || (active as HTMLElement).isContentEditable
}
