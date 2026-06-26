<script lang="ts">
  import {
    createTerminalTabsController,
    type CloseTerminalTabOptions,
  } from '@openforge/terminal-runtime'
  import { onMount, onDestroy, tick } from 'svelte'
  import { commandHeld } from '../../lib/stores'
  import { killPty } from '../../lib/ipc'
  import { release, focusTerminal, getTaskTerminalTabsSession, getShellLifecycleState, subscribeShellLifecycle, updateTaskTerminalTabsSession, type TerminalTab } from '../../lib/terminalPool'
  import TaskTerminal from './TaskTerminal.svelte'

  interface Props {
    taskId: string
    workspacePath: string
    onTabChange: ((index: number) => void) | null
    onTabCountChange: ((count: number) => void) | null
  }

  let { taskId, workspacePath, onTabChange, onTabCountChange }: Props = $props()

  let tabs = $state<TerminalTab[]>([])
  let activeTabIndex = $state(0)
  let liveMessage = $state('')

  const terminalTabsController = createTerminalTabsController({
    taskId: () => taskId,
    getTaskTerminalTabsSession,
    updateTaskTerminalTabsSession,
    getShellLifecycleState,
    subscribeShellLifecycle,
    killPty,
    releaseTerminal: release,
    focusTerminal,
    waitForDomUpdate: tick,
    onTabChange: (index) => onTabChange?.(index),
    onTabCountChange: (count) => onTabCountChange?.(count),
    onSnapshot: (snapshot) => {
      tabs = snapshot.tabs
      activeTabIndex = snapshot.activeTabIndex
      liveMessage = snapshot.liveMessage
    },
  })

  export function addTab() {
    void terminalTabsController.addTab()
  }

  export function switchToTab(tabPosition: number) {
    void terminalTabsController.switchToTab(tabPosition)
  }

  export function focusActiveTab() {
    void terminalTabsController.focusActiveTab()
  }

  export async function closeActiveTab() {
    await terminalTabsController.closeActiveTab()
  }

  function closeTab(tab: TerminalTab, options: CloseTerminalTabOptions = {}) {
    void terminalTabsController.closeTab(tab, options)
  }

  function isTabExited(terminalKey: string): boolean {
    return terminalTabsController.isTabExited(terminalKey)
  }

  function tabStatus(tab: TerminalTab): string {
    return terminalTabsController.tabStatus(tab)
  }

  function tabAccessibleLabel(tab: TerminalTab): string {
    return terminalTabsController.tabAccessibleLabel(tab)
  }

  function panelId(tab: TerminalTab): string {
    return terminalTabsController.panelId(tab)
  }

  function tabId(tab: TerminalTab): string {
    return terminalTabsController.tabId(tab)
  }

  onMount(() => {
    terminalTabsController.hydrate()
  })

  onDestroy(() => {
    terminalTabsController.destroy()
  })
</script>

<div class="flex flex-col h-full">
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
          onclick={() => switchToTab(tabPosition)}
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
