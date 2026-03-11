/** Check if the currently focused element is an input, textarea, select, or contenteditable */
export function isInputFocused(): boolean {
  const active = document.activeElement
  if (!active) return false
  const tagName = active.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || (active as HTMLElement).isContentEditable
}
