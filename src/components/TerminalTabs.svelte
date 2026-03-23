<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { killPty } from '../lib/ipc'
  import { release } from '../lib/terminalPool'
  import TaskTerminal from './TaskTerminal.svelte'

  interface Tab {
    index: number
    key: string
    label: string
  }

  interface Props {
    taskId: string
    worktreePath: string
    onTabChange: ((index: number) => void) | null
    onTabCountChange: ((count: number) => void) | null
  }

  let { taskId, worktreePath, onTabChange, onTabCountChange }: Props = $props()

  let tabs = $state<Tab[]>([])
  let activeTabIndex = $state(0)
  let nextIndex = $state(0)

  function createTab(): Tab {
    const index = nextIndex
    nextIndex = nextIndex + 1
    return {
      index,
      key: `${taskId}-shell-${index}`,
      label: `Shell ${index + 1}`,
    }
  }

  function addTab() {
    const tab = createTab()
    tabs = [...tabs, tab]
    activeTabIndex = tab.index
    onTabChange?.(tab.index)
    onTabCountChange?.(tabs.length)
  }

  function switchToTabByIndex(tabIndex: number) {
    const tab = tabs.find(t => t.index === tabIndex)
    if (tab) {
      activeTabIndex = tab.index
      onTabChange?.(tab.index)
    }
  }

  export function switchToTab(tabIndex: number) {
    switchToTabByIndex(tabIndex)
  }

  async function closeTab(tab: Tab) {
    if (tabs.length <= 1) return

    await killPty(tab.key).catch(e => {
      console.error('[TerminalTabs] Failed to kill PTY on close:', e)
    })
    release(tab.key)

    const tabArrayIndex = tabs.findIndex(t => t.index === tab.index)
    const newTabs = tabs.filter(t => t.index !== tab.index)
    tabs = newTabs

    if (activeTabIndex === tab.index) {
      const nextTab = newTabs[tabArrayIndex] ?? newTabs[tabArrayIndex - 1]
      if (nextTab) {
        activeTabIndex = nextTab.index
        onTabChange?.(nextTab.index)
      }
    }

    onTabCountChange?.(tabs.length)
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.metaKey && e.shiftKey && e.code === 'KeyT' && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      addTab()
    }
  }

  onMount(() => {
    const firstTab = createTab()
    tabs = [firstTab]
    activeTabIndex = firstTab.index
    onTabCountChange?.(1)
    document.addEventListener('keydown', handleKeyDown)
  })

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeyDown)
  })
</script>

<div class="flex flex-col h-full">
  <div class="flex items-center overflow-x-auto border-b border-base-300 bg-base-200 shrink-0">
    {#each tabs as tab (tab.index)}
      <div class="flex items-center whitespace-nowrap">
        <button
          class="flex items-center gap-1 px-3 py-1.5 text-sm {activeTabIndex === tab.index ? 'border-b-2 border-primary text-base-content font-semibold' : 'text-base-content/50'}"
          onclick={() => {
            activeTabIndex = tab.index
            onTabChange?.(tab.index)
          }}
        >
          {tab.label}
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
  <div class="flex-1 min-h-0 overflow-hidden">
    {#each tabs as tab (tab.index)}
      {#if tab.index === activeTabIndex}
        <TaskTerminal
          {taskId}
          {worktreePath}
          terminalKey={tab.key}
          terminalIndex={tab.index}
        />
      {/if}
    {/each}
  </div>
</div>
