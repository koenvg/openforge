<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import type { ResolvedTab } from '../../lib/plugin/contributionResolver'
  import { getTaskPaneShortcut } from '../../lib/taskPaneShortcuts'
  import AnimatedNavList from '../shared/ui/AnimatedNavList.svelte'

  interface Props {
    activeView: string
    tabs: readonly ResolvedTab[]
    commandHeld: boolean
    hasUnreadAgentOutput?: boolean
    onSelect: (viewId: string) => void
  }

  let {
    activeView,
    tabs,
    commandHeld,
    hasUnreadAgentOutput = false,
    onSelect,
  }: Props = $props()

  interface NavigationItem {
    id: string
    title: string
    shortcut: string | null
    capitalize: boolean
  }

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

<nav class="task-pane-navigation" aria-label="Task workbench tabs">
  <AnimatedNavList activeId={activeView} class="task-pane-navigation-items">
    {#snippet children(registerItem)}
      {#each navigationItems as item (item.id)}
        <div class="task-pane-navigation-item" data-animated-nav-item={item.id} use:registerItem={item.id}>
          <Button
            type="button"
            size="md"
            variant="ghost"
            class="task-pane-tab {item.capitalize ? 'capitalize' : ''}"
            aria-pressed={activeView === item.id}
            onclick={() => onSelect(item.id)}
          >
            {item.title}
            {#if item.id === 'agent' && hasUnreadAgentOutput}
              <span
                data-testid="agent-unread-marker"
                class="agent-unread-marker"
                aria-hidden="true"
              ></span>
              <span class="sr-only">Unread agent output</span>
            {/if}
            {#if commandHeld && item.shortcut !== null}<kbd class="task-pane-shortcut">{item.shortcut}</kbd>{/if}
          </Button>
        </div>
      {/each}
    {/snippet}
  </AnimatedNavList>
</nav>

<style>
  .task-pane-navigation {
    position: absolute;
    top: 0;
    left: 50%;
    z-index: 10;
    display: flex;
    height: 100%;
    align-items: center;
    background: var(--of-surface);
    transform: translateX(-50%);
  }

  :global(.task-pane-navigation-items) {
    display: flex;
    align-items: center;
    gap: var(--of-space1);
  }

  .task-pane-navigation-item {
    position: relative;
    display: flex;
  }

  :global(.task-pane-tab) {
    min-width: calc(var(--of-control-height) + var(--of-space6));
    gap: var(--of-space1);
    color: var(--of-text-secondary);
  }

  :global(.task-pane-tab),
  :global(.task-pane-tab:hover),
  :global(.task-pane-tab:active) {
    background: transparent !important;
  }

  :global(.task-pane-tab[aria-pressed='true']) {
    border-color: var(--of-border-interactive);
    color: var(--of-on-accent-subtle);
  }

  .agent-unread-marker {
    width: var(--of-space2);
    height: var(--of-space2);
    flex-shrink: 0;
    border: var(--of-border-width) solid currentColor;
    border-radius: var(--of-radius-round);
    background: var(--of-info);
  }

  .task-pane-shortcut {
    padding: 0 var(--of-space1);
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-control);
    background: var(--of-surface-subtle);
    color: var(--of-text-muted);
    font-family: var(--of-font-mono);
    font-size: var(--of-text-xs);
    font-weight: var(--of-weight-regular);
  }
</style>
