export type MenuNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'

const ENABLED_MENU_ITEM_SELECTOR = [
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
].map((role) => `${role}:not([disabled]):not([aria-disabled="true"])`).join(', ')

export function isMenuNavigationKey(key: string): key is MenuNavigationKey {
  return key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End'
}

export function getEnabledMenuItems(menu: HTMLElement | null): HTMLElement[] {
  if (!menu) return []
  return Array.from(menu.querySelectorAll<HTMLElement>(ENABLED_MENU_ITEM_SELECTOR))
}

export function focusFirstEnabledMenuItem(menu: HTMLElement | null): void {
  const [firstItem] = getEnabledMenuItems(menu)
  const focusTarget = firstItem ?? menu
  focusTarget?.focus()
}

export function moveMenuFocus(menu: HTMLElement | null, key: MenuNavigationKey): void {
  const items = getEnabledMenuItems(menu)
  if (items.length === 0) {
    menu?.focus()
    return
  }

  if (key === 'Home') {
    items[0].focus()
    return
  }

  if (key === 'End') {
    items[items.length - 1].focus()
    return
  }

  const currentIndex = items.indexOf(document.activeElement as HTMLElement)
  const offset = key === 'ArrowDown' ? 1 : -1
  const nextIndex = currentIndex === -1
    ? (offset === 1 ? 0 : items.length - 1)
    : (currentIndex + offset + items.length) % items.length
  items[nextIndex].focus()
}
