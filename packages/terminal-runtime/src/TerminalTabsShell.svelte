<script lang="ts">
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import { onDestroy, onMount, tick, type Component } from 'svelte'
  import {
    createTerminalTabsController,
    type CloseTerminalTabOptions,
    type TerminalTabsControllerOptions,
  } from './terminalControls'
  import type { TerminalTab } from './terminalRuntime'

  export interface TerminalTabsShellTerminalProps {
    taskId: string
    workspacePath: string
    terminalKey: string
    terminalIndex: number
    isActive: boolean
  }

  interface Props extends Omit<TerminalTabsControllerOptions, 'taskId' | 'waitForDomUpdate' | 'onSnapshot'> {
    taskId: string
    workspacePath: string
    shortcutHintsVisible: boolean
    TaskTerminalComponent: Component<TerminalTabsShellTerminalProps>
  }

  let {
    taskId,
    workspacePath,
    shortcutHintsVisible,
    TaskTerminalComponent,
    getTaskTerminalTabsSession,
    updateTaskTerminalTabsSession,
    getShellLifecycleState,
    subscribeShellLifecycle,
    killPty,
    releaseTerminal,
    focusTerminal,
    onTabChange,
    onTabCountChange,
  }: Props = $props()

  let tabs = $state<TerminalTab[]>([])
  let activeTabIndex = $state(0)
  let liveMessage = $state('')

  const terminalTabsController = createTerminalTabsController({
    taskId: () => taskId,
    getTaskTerminalTabsSession: (currentTaskId) => getTaskTerminalTabsSession(currentTaskId),
    updateTaskTerminalTabsSession: (currentTaskId, session) => updateTaskTerminalTabsSession(currentTaskId, session),
    getShellLifecycleState: (terminalKey) => getShellLifecycleState(terminalKey),
    subscribeShellLifecycle: (terminalKey, callback) => subscribeShellLifecycle(terminalKey, callback),
    killPty: (terminalKey) => killPty(terminalKey),
    releaseTerminal: (terminalKey) => releaseTerminal(terminalKey),
    focusTerminal: (terminalKey) => focusTerminal(terminalKey),
    waitForDomUpdate: tick,
    onTabChange: (index) => onTabChange?.(index),
    onTabCountChange: (count) => onTabCountChange?.(count),
    loggerName: 'TerminalTabsShell',
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
      <div class="flex items-center whitespace-nowrap border-b-2 {activeTabIndex === tab.index ? 'border-primary' : 'border-transparent'}">
        <button
          id={tabId(tab)}
          role="tab"
          type="button"
          aria-selected={activeTabIndex === tab.index}
          aria-current={activeTabIndex === tab.index ? 'page' : undefined}
          aria-controls={panelId(tab)}
          aria-label={tabAccessibleLabel(tab)}
          title={`${tab.label} (${tabStatus(tab)})`}
          class="flex items-center gap-1 pl-3 pr-1 py-1.5 text-sm cursor-pointer focus-visible:ring-2 focus-visible:ring-primary rounded-[var(--of-radius-container)] {activeTabIndex === tab.index ? 'text-base-content font-semibold' : 'text-base-content/50'}"
          onclick={() => switchToTab(tabPosition)}
        >
          <span>{tab.label}</span>
          {#if isTabExited(tab.key)}<Badge variant="warning">Exited</Badge>{/if}
          {#if shortcutHintsVisible && tabPosition < 9}<kbd class="kbd kbd-xs opacity-50">⌘⇧{tabPosition + 1}</kbd>{/if}
        </button>
        <IconButton
          label={`Close ${tab.label}`}
          size="xs"
          class="mr-1"
          type="button"
          disabled={tabs.length <= 1 && !isTabExited(tab.key)}
          onclick={() => closeTab(tab, { allowClosingLastTab: isTabExited(tab.key) })}
          title={`Close ${tab.label}`}
        >
          <span aria-hidden="true">×</span>
        </IconButton>
      </div>
    {/each}
    <Button
      variant="ghost"
      size="xs"
      class="mx-2"
      type="button"
      onclick={addTab}
      aria-label="Open new shell"
      title="Open new shell (⌘T)"
    >
      <span aria-hidden="true">+</span>
      <span>New shell</span>
    </Button>
  </div>
  <div class="flex-1 min-h-0 overflow-hidden relative">
    {#each tabs as tab (tab.index)}
      <div
        id={panelId(tab)}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
        class="absolute inset-0 {tab.index === activeTabIndex ? '' : 'invisible pointer-events-none'}"
      >
        <TaskTerminalComponent
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
