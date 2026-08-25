<script lang="ts">
  import type { ResolvedTab } from '../../lib/plugin/contributionResolver'
  import { getTaskPaneShortcut } from '../../lib/taskPaneShortcuts'

  interface Props {
    activeView: string
    tabs: readonly ResolvedTab[]
    commandHeld: boolean
    onSelect: (viewId: string) => void
  }

  let { activeView, tabs, commandHeld, onSelect }: Props = $props()

  interface NavigationItem {
    id: string
    title: string
    shortcut: string | null
    capitalize: boolean
  }

  const activeClasses = 'border-primary bg-primary/5 text-primary'
  const inactiveClasses = 'border-transparent text-base-content/65 hover:bg-base-200/70 hover:text-base-content'
  let navigationItems = $derived<NavigationItem[]>([
    { id: 'agent', title: 'agent', shortcut: '⌘1', capitalize: true },
    { id: 'review', title: 'review', shortcut: '⌘2', capitalize: true },
    ...tabs.map((tab, index) => ({
      id: tab.namespacedId,
      title: tab.title,
      shortcut: getTaskPaneShortcut(index),
      capitalize: false,
    })),
  ])
</script>

<nav class="absolute left-1/2 top-0 z-10 flex h-full -translate-x-1/2 items-center gap-0.5 bg-base-100" aria-label="Task workbench tabs">
  {#each navigationItems as item (item.id)}
    <button
      class="h-full min-w-16 border-b-2 px-3 text-[13px] font-semibold transition-colors {item.capitalize ? 'capitalize' : ''} {activeView === item.id ? activeClasses : inactiveClasses}"
      aria-pressed={activeView === item.id}
      onclick={() => onSelect(item.id)}
    >{item.title}{#if commandHeld && item.shortcut !== null}<kbd class="kbd kbd-xs opacity-50">{item.shortcut}</kbd>{/if}</button>
  {/each}
</nav>
