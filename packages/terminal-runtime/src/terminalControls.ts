import { createIndexedShellSessionKey } from './ptySessionKey'
import type {
  ShellLifecycleState,
  TaskTerminalTabsSession,
  TerminalRuntimeUnlistenFn,
  TerminalTab,
} from './terminalRuntime'

export const TERMINAL_FOCUS_DESCRIPTION_TEXT = 'Terminal focus: after selecting a shell tab, press Tab to focus this terminal region. Type commands when the terminal cursor is active.'
export const TERMINAL_TASK_PANE_WORKSPACE_RECOVERY_TEXT = 'Start or repair the task workspace, then retry loading the terminal.'
export const TERMINAL_TASK_PANE_KEYBOARD_FOCUS_PATH_TEXT = 'Keyboard focus path: resolve the workspace first, then Tab to shell tabs, choose New shell, and Tab into the terminal region.'

export interface CloseTerminalTabOptions {
  allowClosingLastTab?: boolean
}

export interface TerminalTabsControllerSnapshot {
  session: TaskTerminalTabsSession | null
  tabs: TerminalTab[]
  activeTabIndex: number
  nextIndex: number
  tabLifecycleByKey: Map<string, ShellLifecycleState>
  liveMessage: string
}

export interface TerminalTabsControllerOptions {
  taskId: string | (() => string)
  getTaskTerminalTabsSession(taskId: string): TaskTerminalTabsSession
  updateTaskTerminalTabsSession(taskId: string, session: TaskTerminalTabsSession): void
  getShellLifecycleState(terminalKey: string): ShellLifecycleState
  subscribeShellLifecycle(terminalKey: string, callback: (state: ShellLifecycleState) => void): TerminalRuntimeUnlistenFn
  killPty(terminalKey: string): Promise<void>
  releaseTerminal(terminalKey: string): void
  focusTerminal(terminalKey: string): void
  waitForDomUpdate?: () => Promise<void>
  onTabChange?: (index: number) => void
  onTabCountChange?: (count: number) => void
  onSnapshot?: (snapshot: TerminalTabsControllerSnapshot) => void
  loggerName?: string
}

export interface TerminalTabsController {
  hydrate(): void
  destroy(): void
  addTab(): Promise<void>
  switchToTab(tabPosition: number): Promise<void>
  focusActiveTab(): Promise<void>
  closeActiveTab(): Promise<void>
  closeTab(tab: TerminalTab, options?: CloseTerminalTabOptions): Promise<void>
  getSnapshot(): TerminalTabsControllerSnapshot
  getSession(taskId: string): TaskTerminalTabsSession
  isTabExited(terminalKey: string): boolean
  tabStatus(tab: TerminalTab): string
  tabAccessibleLabel(tab: TerminalTab): string
  panelId(tab: TerminalTab): string
  tabId(tab: TerminalTab): string
}

export function getShellLabel(terminalIndex: number): string {
  return `Shell ${terminalIndex + 1}`
}

export function getTerminalFocusDescriptionId(terminalKey: string): string {
  return `terminal-focus-description-${terminalKey}`
}

export function getTerminalRegionAriaLabel(shellLabel: string): string {
  return `Terminal region for ${shellLabel}`
}

export function getTerminalRegionTitle(shellLabel: string): string {
  return getTerminalRegionAriaLabel(shellLabel)
}

export function getRestartShellAriaLabel(shellLabel: string): string {
  return `Restart ${shellLabel}`
}

export function getRestartShellTitle(shellLabel: string): string {
  return getRestartShellAriaLabel(shellLabel)
}

export function getTerminalTabPanelId(tab: TerminalTab): string {
  return `terminal-panel-${tab.key}`
}

export function getTerminalTabTriggerId(tab: TerminalTab): string {
  return `terminal-tab-${tab.key}`
}

export function isTerminalTabExited(lifecycle: ShellLifecycleState | null | undefined): boolean {
  return lifecycle?.shellExited ?? false
}

export function getTerminalTabStatus(tab: TerminalTab, activeTabIndex: number, lifecycle: ShellLifecycleState | null | undefined): string {
  if (isTerminalTabExited(lifecycle)) return 'exited'
  if (activeTabIndex === tab.index) return 'active'
  return 'inactive'
}

export function getTerminalTabAccessibleLabel(tab: TerminalTab, activeTabIndex: number, lifecycle: ShellLifecycleState | null | undefined): string {
  const activeState = activeTabIndex === tab.index ? 'active' : 'inactive'
  const lifecycleState = isTerminalTabExited(lifecycle) ? 'exited' : 'running'
  return `${tab.label}, ${activeState}, ${lifecycleState}`
}

export function shouldShowShellReadyAffordance(isActive: boolean, lifecycle: ShellLifecycleState): boolean {
  return isActive && lifecycle.ptyActive && !lifecycle.shellExited && !lifecycle.hasOutput
}

function cloneSnapshot(snapshot: TerminalTabsControllerSnapshot): TerminalTabsControllerSnapshot {
  return {
    session: snapshot.session,
    tabs: snapshot.tabs,
    activeTabIndex: snapshot.activeTabIndex,
    nextIndex: snapshot.nextIndex,
    tabLifecycleByKey: new Map(snapshot.tabLifecycleByKey),
    liveMessage: snapshot.liveMessage,
  }
}

export function createTerminalTabsController(options: TerminalTabsControllerOptions): TerminalTabsController {
  let session: TaskTerminalTabsSession | null = null
  let tabs: TerminalTab[] = []
  let activeTabIndex = 0
  let nextIndex = 0
  let tabLifecycleByKey = new Map<string, ShellLifecycleState>()
  let liveMessage = ''
  const tabLifecycleUnsubscribers = new Map<string, TerminalRuntimeUnlistenFn>()
  const waitForDomUpdate = options.waitForDomUpdate ?? (async () => undefined)
  const loggerName = options.loggerName ?? 'TerminalTabs'

  function getTaskId(): string {
    return typeof options.taskId === 'function' ? options.taskId() : options.taskId
  }

  function snapshot(): TerminalTabsControllerSnapshot {
    return cloneSnapshot({ session, tabs, activeTabIndex, nextIndex, tabLifecycleByKey, liveMessage })
  }

  function notifySnapshot(): void {
    options.onSnapshot?.(snapshot())
  }

  function announce(message: string): void {
    liveMessage = message
    notifySnapshot()
  }

  function setTabLifecycle(terminalKey: string, state: ShellLifecycleState, announceTransitions = false): void {
    const previous = tabLifecycleByKey.get(terminalKey)
    tabLifecycleByKey = new Map(tabLifecycleByKey)
    tabLifecycleByKey.set(terminalKey, state)
    notifySnapshot()

    if (!announceTransitions) return
    const tab = tabs.find(candidate => candidate.key === terminalKey)
    if (!tab) return
    if (!previous?.shellExited && state.shellExited) {
      announce(`${tab.label} exited. Use Restart shell to start it again.`)
    } else if (previous?.shellExited && !state.shellExited && state.ptyActive) {
      announce(`${tab.label} restarted. Focus returned to ${tab.label} terminal.`)
    }
  }

  function removeTabLifecycle(terminalKey: string): void {
    tabLifecycleByKey = new Map(tabLifecycleByKey)
    tabLifecycleByKey.delete(terminalKey)
    notifySnapshot()
  }

  function isTabExited(terminalKey: string): boolean {
    return isTerminalTabExited(tabLifecycleByKey.get(terminalKey))
  }

  function syncTabLifecycleSubscriptions(): void {
    const currentKeys = new Set(tabs.map(tab => tab.key))

    for (const [terminalKey, unsubscribe] of tabLifecycleUnsubscribers) {
      if (!currentKeys.has(terminalKey)) {
        unsubscribe()
        tabLifecycleUnsubscribers.delete(terminalKey)
        removeTabLifecycle(terminalKey)
      }
    }

    for (const tab of tabs) {
      if (tabLifecycleUnsubscribers.has(tab.key)) continue
      setTabLifecycle(tab.key, options.getShellLifecycleState(tab.key))
      tabLifecycleUnsubscribers.set(tab.key, options.subscribeShellLifecycle(tab.key, (state) => {
        setTabLifecycle(tab.key, state, true)
      }))
    }
  }

  function clearTabLifecycleSubscriptions(): void {
    for (const unsubscribe of tabLifecycleUnsubscribers.values()) unsubscribe()
    tabLifecycleUnsubscribers.clear()
    tabLifecycleByKey = new Map()
    notifySnapshot()
  }

  function syncSession(): void {
    if (!session) return
    const taskId = getTaskId()
    options.updateTaskTerminalTabsSession(taskId, { tabs, activeTabIndex, nextIndex })
    session = options.getTaskTerminalTabsSession(taskId)
    syncTabLifecycleSubscriptions()
    notifySnapshot()
  }

  function createTab(): TerminalTab {
    const index = nextIndex
    nextIndex = nextIndex + 1
    return {
      index,
      key: createIndexedShellSessionKey({ taskId: getTaskId(), terminalIndex: index }),
      label: getShellLabel(index),
    }
  }

  async function focusTerminalTab(terminalKey: string): Promise<void> {
    await waitForDomUpdate()
    const activeTab = tabs.find(tab => tab.index === activeTabIndex) ?? tabs[0]
    if (activeTab?.key === terminalKey) options.focusTerminal(terminalKey)
  }

  return {
    hydrate() {
      session = options.getTaskTerminalTabsSession(getTaskId())
      tabs = session.tabs
      activeTabIndex = session.activeTabIndex
      nextIndex = session.nextIndex
      syncTabLifecycleSubscriptions()
      notifySnapshot()
      options.onTabCountChange?.(tabs.length)
    },

    destroy() {
      clearTabLifecycleSubscriptions()
    },

    async addTab() {
      const tab = createTab()
      tabs = [...tabs, tab]
      activeTabIndex = tab.index
      syncSession()
      options.onTabChange?.(tab.index)
      options.onTabCountChange?.(tabs.length)
      announce(`${tab.label} created. Focus moved to ${tab.label} terminal.`)
      await focusTerminalTab(tab.key)
    },

    async switchToTab(tabPosition: number) {
      const tab = tabs[tabPosition]
      if (!tab) return
      activeTabIndex = tab.index
      syncSession()
      options.onTabChange?.(tab.index)
      await focusTerminalTab(tab.key)
    },

    async focusActiveTab() {
      const activeTab = tabs.find(tab => tab.index === activeTabIndex) ?? tabs[0]
      if (activeTab) await focusTerminalTab(activeTab.key)
    },

    async closeActiveTab() {
      const activeTab = tabs.find(tab => tab.index === activeTabIndex)
      if (!activeTab) return
      await this.closeTab(activeTab, { allowClosingLastTab: isTabExited(activeTab.key) })
    },

    async closeTab(tab: TerminalTab, closeOptions: CloseTerminalTabOptions = {}) {
      const { allowClosingLastTab = false } = closeOptions
      if (tabs.length <= 1 && !allowClosingLastTab) return

      const tabArrayIndex = tabs.findIndex(candidate => candidate.index === tab.index)
      if (tabArrayIndex === -1) return

      await options.killPty(tab.key).catch(e => {
        console.error(`[${loggerName}] Failed to kill PTY on close:`, e)
      })
      options.releaseTerminal(tab.key)

      const newTabs = tabs.filter(candidate => candidate.index !== tab.index)
      tabs = newTabs

      let focusTargetLabel = 'no shell'
      let focusTargetKey: string | null = null
      let nextActiveTabIndex: number | null = null
      if (activeTabIndex === tab.index) {
        const nextTab = newTabs[tabArrayIndex] ?? newTabs[tabArrayIndex - 1]
        if (nextTab) {
          activeTabIndex = nextTab.index
          nextActiveTabIndex = nextTab.index
          focusTargetLabel = nextTab.label
          focusTargetKey = nextTab.key
        } else {
          activeTabIndex = 0
        }
      } else {
        const activeTab = newTabs.find(candidate => candidate.index === activeTabIndex)
        if (activeTab) {
          focusTargetLabel = activeTab.label
          focusTargetKey = activeTab.key
        }
      }

      syncSession()
      if (nextActiveTabIndex !== null) options.onTabChange?.(nextActiveTabIndex)
      if (focusTargetKey !== null) await focusTerminalTab(focusTargetKey)
      options.onTabCountChange?.(tabs.length)
      announce(`${tab.label} closed. Focus moved to ${focusTargetLabel}.`)
    },

    getSnapshot() {
      return snapshot()
    },

    getSession(taskId: string) {
      return options.getTaskTerminalTabsSession(taskId)
    },

    isTabExited,

    tabStatus(tab: TerminalTab) {
      return getTerminalTabStatus(tab, activeTabIndex, tabLifecycleByKey.get(tab.key))
    },

    tabAccessibleLabel(tab: TerminalTab) {
      return getTerminalTabAccessibleLabel(tab, activeTabIndex, tabLifecycleByKey.get(tab.key))
    },

    panelId(tab: TerminalTab) {
      return getTerminalTabPanelId(tab)
    },

    tabId(tab: TerminalTab) {
      return getTerminalTabTriggerId(tab)
    },
  }
}
