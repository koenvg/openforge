export function useAppShortcutHelpController() {
  let isOpen = $state(false)

  function open(): void {
    isOpen = true
  }

  function close(): void {
    isOpen = false
  }

  return {
    get isOpen() {
      return isOpen
    },
    open,
    close,
  }
}

export type AppShortcutHelpController = ReturnType<typeof useAppShortcutHelpController>
