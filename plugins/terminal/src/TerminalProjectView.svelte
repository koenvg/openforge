<script lang="ts">
  import PluginPageShell from '@openforge-app/plugin-sdk/ui/PluginPageShell.svelte'
  import PluginPageHeader from '@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte'
  import { onMount } from 'svelte'
  import TerminalTabs from './TerminalTabs.svelte'
  import { getProjectTerminalTaskId } from './lib/projectTerminal'
  import { createTerminalShortcutController } from './terminalShortcutController'

  interface Props {
    projectId?: string | null
    projectName?: string
    projectPath?: string
  }

  let { projectId = null, projectName = '', projectPath = '' }: Props = $props()

  const terminalTaskId = $derived(projectId ? getProjectTerminalTaskId(projectId) : null)
  const workspaceUnavailableMessage = $derived(
    !projectId
      ? 'Select a project to open a terminal.'
      : !projectPath
        ? 'Project path unavailable. Terminal shells require a project path.'
        : ''
  )

  let shortcutRoot = $state<HTMLElement | null>(null)
  const terminalShortcuts = createTerminalShortcutController({ shortcutRoot: () => shortcutRoot })
  let terminalTabsRef = $state<TerminalTabs | null>(null)

  $effect(() => {
    terminalShortcuts.terminalTabsRef = terminalTabsRef
  })

  onMount(() => terminalShortcuts.registerWindowKeydown())
</script>

<div bind:this={shortcutRoot} class="flex flex-col h-full min-h-0 overflow-hidden">
  <div class="sr-only" aria-live="polite" aria-atomic="true">{workspaceUnavailableMessage}</div>
  <PluginPageShell>
    {#snippet header()}
      <PluginPageHeader
        title={`${projectName || 'Project'} — Terminal`}
        subtitle={projectPath || null}
        headingLevel="h2"
      />
    {/snippet}

    <div class="flex flex-1 min-h-0 overflow-hidden">
      {#if !projectId}
        <div class="flex-1 flex flex-col items-center justify-center gap-2 text-of-text/50 text-sm p-6 text-center" role="status" aria-live="polite">
          <p>{workspaceUnavailableMessage}</p>
          <p class="sr-only">Terminal workspace unavailable</p>
        </div>
      {:else if !projectPath}
        <div class="flex-1 flex flex-col items-center justify-center gap-2 text-of-text/50 text-sm p-6 text-center" role="status" aria-live="polite">
          <p>{workspaceUnavailableMessage}</p>
          <p class="text-xs text-of-text/50">
            <span class="font-semibold">Keyboard focus path:</span> choose a project with a path first, then Tab to shell tabs, choose New shell, and Tab into the terminal region.
          </p>
          <p class="sr-only">Terminal workspace unavailable</p>
        </div>
      {:else if terminalTaskId}
        <div class="flex-1 min-w-0 h-full overflow-hidden">
          <p class="sr-only">
            <span>Keyboard focus path:</span> Tab to shell tabs, choose New shell or press Cmd+T, then Tab into the terminal region.
          </p>
          {#key terminalTaskId}
            <TerminalTabs
              bind:this={terminalTabsRef}
              taskId={terminalTaskId}
              workspacePath={projectPath}
              onTabChange={null}
              onTabCountChange={null}
            />
          {/key}
        </div>
      {/if}
    </div>
  </PluginPageShell>
</div>
