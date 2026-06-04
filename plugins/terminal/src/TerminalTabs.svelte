<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
  import type { ShellSessionIdentity } from '@openforge/plugin-sdk'
  import { commandHeld } from './lib/stores'
  import { release, focusTerminal, getTaskTerminalTabsSession, updateTaskTerminalTabsSession, type TerminalTab, type TaskTerminalTabsSession } from './lib/terminalPool'
  import { createTaskShellSession } from './lib/projectTerminal'
  import TaskTerminal from './TaskTerminal.svelte'

  interface Props {
    api: FrontendOpenForgeAPI
    taskId: string
    workspacePath: string
    createShellSession?: (contextId: string, tabIndex: number) => ShellSessionIdentity
    onTabChange: ((index: number) => void) | null
    onTabCountChange: ((count: number) => void) | null
  }

  let { api, taskId, workspacePath, createShellSession = createTaskShellSession, onTabChange, onTabCountChange }: Props = $props()

  let session: TaskTerminalTabsSession | null = null
  let tabs = $state<TerminalTab[]>([])
  let activeTabIndex = $state(0)
  let nextIndex = $state(0)

  interface CloseTabOptions {
    allowClosingLastTab?: boolean
  }

  function shellSessionForIndex(index: number): ShellSessionIdentity {
    return createShellSession(taskId, index)
  }

  function hydrateFromSession(taskId: string) {
    session = getTaskTerminalTabsSession(taskId)
    tabs = session.tabs.map(tab => ({ ...tab, key: shellSessionForIndex(tab.index).id }))
    activeTabIndex = session.activeTabIndex
    nextIndex = session.nextIndex
  }

  function syncSession() {
    if (!session) return
    updateTaskTerminalTabsSession(taskId, {
      tabs,
      activeTabIndex,
      nextIndex,
    })
    session = getTaskTerminalTabsSession(taskId)
  }

  function createTab(): TerminalTab {
    const index = nextIndex
    nextIndex = nextIndex + 1
    return {
      index,
      key: shellSessionForIndex(index).id,
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

    await closeTab(activeTab)
  }

  async function closeTab(tab: TerminalTab, options: CloseTabOptions = {}) {
    const { allowClosingLastTab = false } = options
    if (tabs.length <= 1 && !allowClosingLastTab) return

    const tabArrayIndex = tabs.findIndex(t => t.index === tab.index)
    if (tabArrayIndex === -1) return

    await api.shell.kill({ session: shellSessionForIndex(tab.index) }).catch(e => {
      console.error('[TerminalTabs] Failed to kill shell on close:', e)
    })
    release(tab.key)

    const newTabs = tabs.filter(t => t.index !== tab.index)
    tabs = newTabs

    if (activeTabIndex === tab.index) {
      const nextTab = newTabs[tabArrayIndex] ?? newTabs[tabArrayIndex - 1]
      if (nextTab) {
        activeTabIndex = nextTab.index
        onTabChange?.(nextTab.index)
        await focusTerminalTab(nextTab.key)
      } else {
        activeTabIndex = 0
      }
    }

    syncSession()
    onTabCountChange?.(tabs.length)
  }

  onMount(() => {
    hydrateFromSession(taskId)
    onTabCountChange?.(tabs.length)
  })
</script>

<div class="flex flex-col h-full">
  <div class="flex items-center overflow-x-auto border-b border-base-300 bg-base-200 shrink-0">
    {#each tabs as tab, tabPosition (tab.index)}
      <div class="flex items-center whitespace-nowrap">
          <button
            class="flex items-center gap-1 px-3 py-1.5 text-sm {activeTabIndex === tab.index ? 'border-b-2 border-primary text-base-content font-semibold' : 'text-base-content/50'}"
            onclick={() => {
              activeTabIndex = tab.index
              syncSession()
              onTabChange?.(tab.index)
              void focusTerminalTab(tab.key)
            }}
         >
           {tab.label}{#if $commandHeld && tabPosition < 9}<kbd class="kbd kbd-xs opacity-50">⌘⇧{tabPosition + 1}</kbd>{/if}
         </button>
        <button
          class="pr-2 text-xs leading-none opacity-60 hover:opacity-100"
          disabled={tabs.length <= 1}
          onclick={() => closeTab(tab)}
          aria-label="×"
        >
          ×
        </button>
      </div>
    {/each}
    <button
      class="px-2 py-1.5 text-base-content/50 hover:text-base-content text-sm"
      onclick={addTab}
      aria-label="+"
    >
      +
    </button>
  </div>
  <div class="flex-1 min-h-0 overflow-hidden relative">
    {#each tabs as tab (tab.index)}
      <div class="absolute inset-0 {tab.index === activeTabIndex ? '' : 'invisible pointer-events-none'}">
        <TaskTerminal
          {api}
          session={shellSessionForIndex(tab.index)}
          {workspacePath}
          isActive={tab.index === activeTabIndex}
          onExit={() => closeTab(tab, { allowClosingLastTab: true })}
        />
      </div>
    {/each}
  </div>
</div>
