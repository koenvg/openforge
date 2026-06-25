import { handleTerminalShortcutKeydown, type TerminalShortcutController } from './terminalShortcuts'

export interface TerminalTabsShortcutTarget {
  addTab(): void
  closeActiveTab(): Promise<void>
  focusActiveTab(): void
  switchToTab(tabPosition: number): void
}

export interface TerminalShortcutControllerOptions {
  ignoreWhenDetached?: boolean
  isActive?: () => boolean
  shortcutRoot?: () => HTMLElement | null
}

export interface TerminalShortcutKeydownTarget {
  addEventListener(type: 'keydown', listener: EventListener, options?: AddEventListenerOptions): void
  removeEventListener(type: 'keydown', listener: EventListener, options?: AddEventListenerOptions): void
}

export interface TerminalShortcutControllerWiring {
  terminalTabsRef: TerminalTabsShortcutTarget | null
  controller: TerminalShortcutController
  handleWindowKeydown(event: KeyboardEvent): boolean
  registerWindowKeydown(target?: TerminalShortcutKeydownTarget): () => void
}

export function isTerminalShortcutScopeVisible(root: HTMLElement | null): boolean {
  if (!root || !root.isConnected) return false

  let element: HTMLElement | null = root
  while (element) {
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false

    const styles = globalThis.window?.getComputedStyle(element)
    if (styles !== undefined && (styles.display === 'none' || styles.visibility === 'hidden')) {
      return false
    }

    element = element.parentElement
  }

  return true
}

export function createTerminalShortcutController(
  options: TerminalShortcutControllerOptions = {},
): TerminalShortcutControllerWiring {
  let terminalTabsRef: TerminalTabsShortcutTarget | null = null

  const controller: TerminalShortcutController = {
    addTab() {
      terminalTabsRef?.addTab()
    },
    async closeActiveTab() {
      await terminalTabsRef?.closeActiveTab()
    },
    focusActiveTab() {
      terminalTabsRef?.focusActiveTab()
    },
    switchToTab(tabPosition: number) {
      terminalTabsRef?.switchToTab(tabPosition)
    },
  }

  function isRootActive(): boolean {
    const root = options.shortcutRoot?.()
    return root === undefined || isTerminalShortcutScopeVisible(root)
  }

  function isShortcutScopeActive(): boolean {
    if (terminalTabsRef === null && options.ignoreWhenDetached !== false) return false
    if (options.isActive?.() === false) return false

    return isRootActive()
  }

  function handleWindowKeydown(event: KeyboardEvent): boolean {
    if (!isShortcutScopeActive()) return false

    return handleTerminalShortcutKeydown(event, controller)
  }

  function registerWindowKeydown(target: TerminalShortcutKeydownTarget = window): () => void {
    const listener: EventListener = (event) => {
      if (event instanceof KeyboardEvent) {
        handleWindowKeydown(event)
      }
    }
    const listenerOptions = { capture: true }

    target.addEventListener('keydown', listener, listenerOptions)

    return () => {
      target.removeEventListener('keydown', listener, listenerOptions)
    }
  }

  return {
    get terminalTabsRef() {
      return terminalTabsRef
    },
    set terminalTabsRef(value: TerminalTabsShortcutTarget | null) {
      terminalTabsRef = value
    },
    controller,
    handleWindowKeydown,
    registerWindowKeydown,
  }
}
