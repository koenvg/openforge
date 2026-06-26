<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { commandHeld } from '../../lib/stores'
  import { killPty } from '../../lib/ipc'
  import { release, focusTerminal, getTaskTerminalTabsSession, getShellLifecycleState, subscribeShellLifecycle, updateTaskTerminalTabsSession, type ShellLifecycleState, type TerminalTab, type TaskTerminalTabsSession } from '../../lib/terminalPool'
  import TaskTerminal from './TaskTerminal.svelte'

  interface Props {
    taskId: string
    workspacePath: string
    onTabChange: ((index: number) => void) | null
    onTabCountChange: ((count: number) => void) | null
  }

  let { taskId, workspacePath, onTabChange, onTabCountChange }: Props = $props()

  let session: TaskTerminalTabsSession | null = null
  let tabs = $state<TerminalTab[]>([])
  let activeTabIndex = $state(0)
  let nextIndex = $state(0)
  let tabLifecycleByKey = $state(new Map<string, ShellLifecycleState>())
  let liveMessage = $state('')
  const tabLifecycleUnsubscribers = new Map<string, () => void>()

  interface CloseTabOptions {
    allowClosingLastTab?: boolean
  }

  function announce(message: string) {
    liveMessage = message
  }

  function setTabLifecycle(terminalKey: string, state: ShellLifecycleState, announceTransitions = false) {
    const previous = tabLifecycleByKey.get(terminalKey)
    const next = new Map(tabLifecycleByKey)
    next.set(terminalKey, state)
    tabLifecycleByKey = next

    if (!announceTransitions) return
    const tab = tabs.find(candidate => candidate.key === terminalKey)
    if (!tab) return
    if (!previous?.shellExited && state.shellExited) {
      announce(`${tab.label} exited. Use Restart shell to start it again.`)
    } else if (previous?.shellExited && !state.shellExited && state.ptyActive) {
      announce(`${tab.label} restarted. Focus returned to ${tab.label} terminal.`)
    }
  }

  function removeTabLifecycle(terminalKey: string) {
    const next = new Map(tabLifecycleByKey)
    next.delete(terminalKey)
    tabLifecycleByKey = next
  }

  function isTabExited(terminalKey: string): boolean {
    return tabLifecycleByKey.get(terminalKey)?.shellExited ?? false
  }

  function tabStatus(tab: TerminalTab): string {
    if (isTabExited(tab.key)) return 'exited'
    if (activeTabIndex === tab.index) return 'active'
    return 'inactive'
  }

  function tabAccessibleLabel(tab: TerminalTab): string {
    const activeState = activeTabIndex === tab.index ? 'active' : 'inactive'
    const lifecycleState = isTabExited(tab.key) ? 'exited' : 'running'
    return `${tab.label}, ${activeState}, ${lifecycleState}`
  }

  function panelId(tab: TerminalTab): string {
    return `terminal-panel-${tab.key}`
  }

  function tabId(tab: TerminalTab): string {
    return `terminal-tab-${tab.key}`
  }

  function syncTabLifecycleSubscriptions() {
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
      setTabLifecycle(tab.key, getShellLifecycleState(tab.key))
      tabLifecycleUnsubscribers.set(tab.key, subscribeShellLifecycle(tab.key, (state) => {
        setTabLifecycle(tab.key, state, true)
      }))
    }
  }

  function clearTabLifecycleSubscriptions() {
    for (const unsubscribe of tabLifecycleUnsubscribers.values()) {
      unsubscribe()
    }
    tabLifecycleUnsubscribers.clear()
    tabLifecycleByKey = new Map()
  }

  function hydrateFromSession(taskId: string) {
    session = getTaskTerminalTabsSession(taskId)
    tabs = session.tabs
    activeTabIndex = session.activeTabIndex
    nextIndex = session.nextIndex
    syncTabLifecycleSubscriptions()
  }

  function syncSession() {
    if (!session) return
    updateTaskTerminalTabsSession(taskId, {
      tabs,
      activeTabIndex,
      nextIndex,
    })
    session = getTaskTerminalTabsSession(taskId)
    syncTabLifecycleSubscriptions()
  }

  function createTab(): TerminalTab {
    const index = nextIndex
    nextIndex = nextIndex + 1
    return {
      index,
      key: `${taskId}-shell-${index}`,
      label: `Shell ${index + 1}`,
    }
  }

  async function focusTerminalTab(terminalKey: string) {
    await tick()
    const activeTab = tabs.find(tab => tab.index === activeTabIndex) ?? tabs[0]
    if (activeTab?.key === terminalKey) {
      focusTerminal(terminalKey)
    }
  }

  export function addTab() {
    const tab = createTab()
    tabs = [...tabs, tab]
    activeTabIndex = tab.index
    syncSession()
    onTabChange?.(tab.index)
    onTabCountChange?.(tabs.length)
    announce(`${tab.label} created. Focus moved to ${tab.label} terminal.`)
    void focusTerminalTab(tab.key)
  }

  function switchToTabByPosition(tabPosition: number) {
    const tab = tabs[tabPosition]
    if (tab) {
      activeTabIndex = tab.index
      syncSession()
      onTabChange?.(tab.index)
      void focusTerminalTab(tab.key)
    }
  }

  export function switchToTab(tabPosition: number) {
    switchToTabByPosition(tabPosition)
  }

  export function focusActiveTab() {
    const activeTab = tabs.find(tab => tab.index === activeTabIndex) ?? tabs[0]
    if (activeTab) void focusTerminalTab(activeTab.key)
  }

  export async function closeActiveTab() {
    const activeTab = tabs.find(tab => tab.index === activeTabIndex)
    if (!activeTab) return

    await closeTab(activeTab, { allowClosingLastTab: isTabExited(activeTab.key) })
  }

  async function closeTab(tab: TerminalTab, options: CloseTabOptions = {}) {
    const { allowClosingLastTab = false } = options
    if (tabs.length <= 1 && !allowClosingLastTab) return

    const tabArrayIndex = tabs.findIndex(t => t.index === tab.index)
    if (tabArrayIndex === -1) return

    await killPty(tab.key).catch(e => {
      console.error('[TerminalTabs] Failed to kill PTY on close:', e)
    })
    release(tab.key)

    const newTabs = tabs.filter(t => t.index !== tab.index)
    tabs = newTabs

    let focusTargetLabel = 'no shell'
    if (activeTabIndex === tab.index) {
      const nextTab = newTabs[tabArrayIndex] ?? newTabs[tabArrayIndex - 1]
      if (nextTab) {
        activeTabIndex = nextTab.index
        focusTargetLabel = nextTab.label
        onTabChange?.(nextTab.index)
        await focusTerminalTab(nextTab.key)
      } else {
        activeTabIndex = 0
      }
    } else {
      const activeTab = newTabs.find(t => t.index === activeTabIndex)
      if (activeTab) {
        focusTargetLabel = activeTab.label
        await focusTerminalTab(activeTab.key)
      }
    }

    syncSession()
    onTabCountChange?.(tabs.length)
    announce(`${tab.label} closed. Focus moved to ${focusTargetLabel}.`)
  }

  onMount(() => {
    hydrateFromSession(taskId)
    onTabCountChange?.(tabs.length)
  })

  onDestroy(() => {
    clearTabLifecycleSubscriptions()
  })
</script>

<div class="flex flex-col h-full">
  <div class="px-3 py-2 text-xs text-base-content/70 border-b border-base-300 bg-base-100">
    <span class="font-semibold">Keyboard focus path:</span> Tab to the shell tabs, choose <span class="font-medium">New shell</span> or press <kbd class="kbd kbd-xs">⌘T</kbd>, then Tab into the terminal region. Use <kbd class="kbd kbd-xs">⌘⇧1–9</kbd> to switch shells.
  </div>
  <div class="sr-only" aria-live="polite" aria-atomic="true">{liveMessage}</div>
  <div class="flex items-center overflow-x-auto border-b border-base-300 bg-base-200 shrink-0" role="tablist" aria-label="Shell terminals">
    {#each tabs as tab, tabPosition (tab.index)}
      <div class="flex items-center whitespace-nowrap">
        <button
          id={tabId(tab)}
          role="tab"
          type="button"
          aria-selected={activeTabIndex === tab.index}
          aria-current={activeTabIndex === tab.index ? 'page' : undefined}
          aria-controls={panelId(tab)}
          aria-label={tabAccessibleLabel(tab)}
          title={`${tab.label} (${tabStatus(tab)})`}
          class="flex items-center gap-1 px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-primary rounded {activeTabIndex === tab.index ? 'border-b-2 border-primary text-base-content font-semibold' : 'text-base-content/50'}"
          onclick={() => {
            activeTabIndex = tab.index
            syncSession()
            onTabChange?.(tab.index)
            void focusTerminalTab(tab.key)
          }}
        >
          <span>{tab.label}</span>
          {#if activeTabIndex === tab.index}<span class="badge badge-primary badge-xs">Active</span>{/if}
          {#if isTabExited(tab.key)}<span class="badge badge-warning badge-xs">Exited</span>{/if}
          {#if $commandHeld && tabPosition < 9}<kbd class="kbd kbd-xs opacity-50">⌘⇧{tabPosition + 1}</kbd>{/if}
        </button>
        <button
          type="button"
          class="px-2 py-1.5 text-xs leading-none opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary rounded"
          disabled={tabs.length <= 1 && !isTabExited(tab.key)}
          onclick={() => closeTab(tab, { allowClosingLastTab: isTabExited(tab.key) })}
          aria-label={`Close ${tab.label}`}
          title={`Close ${tab.label}`}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    {/each}
    <button
      type="button"
      class="btn btn-ghost btn-xs mx-2 text-base-content/70 hover:text-base-content focus-visible:ring-2 focus-visible:ring-primary"
      onclick={addTab}
      aria-label="Open new shell"
      title="Open new shell (⌘T)"
    >
      <span aria-hidden="true">+</span>
      <span>New shell</span>
    </button>
  </div>
  <div class="flex-1 min-h-0 overflow-hidden relative">
    {#each tabs as tab (tab.index)}
      <div
        id={panelId(tab)}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
        class="absolute inset-0 {tab.index === activeTabIndex ? '' : 'invisible pointer-events-none'}"
      >
        <TaskTerminal
          {taskId}
          {workspacePath}
          terminalKey={tab.key}
          terminalIndex={tab.index}
          isActive={tab.index === activeTabIndex}
        />
      </div>
    {/each}
  </div>
</div>
