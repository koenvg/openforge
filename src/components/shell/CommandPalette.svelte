<script lang="ts">
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import { onMount } from 'svelte'
  import { activeSessions, projects, activeProjectId } from '../../lib/stores'
  import { matchesSearch, sortTasks, filterActiveTasks, navigateToTask } from '../../lib/commandPalette'
  import { getLatestSessions, readActiveTasks } from '../../lib/ipc'
  import { resolveContributions } from '../../lib/plugin/contributionResolver'
  import { executePluginCommand } from '../../lib/plugin/pluginRegistry'
  import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
  import type { TaskDetail } from '../../lib/types'
  import PaletteFooter from '../shared/ui/PaletteFooter.svelte'
  import PaletteInput from '../shared/ui/PaletteInput.svelte'
  import PaletteListbox from '../shared/ui/PaletteListbox.svelte'
  import PaletteModal from './PaletteModal.svelte'

  interface Props {
    onClose: () => void
  }

  let { onClose }: Props = $props()

  let searchQuery = $state('')
  let selectedTaskKey = $state<string | null>(null)
  let allTasks = $state<TaskDetail[]>([])
  let loading = $state(true)

  let projectMap = $derived(new Map($projects.map(p => [p.id, p])))
  let enabledPluginContributionSources = $derived(
    Array.from($enabledPluginIds)
      .map((pluginId) => $runtimeContributionSources.get(pluginId))
      .filter((source) => source !== undefined)
  )
  let pluginCommands = $derived(resolveContributions(enabledPluginContributionSources).commands.filter((command) => command.discoverable))

  async function loadActiveTasks() {
    loading = true
    try {
      const pages = await Promise.all($projects.map((project) => readActiveTasks(project.id)))
      const activeTasks = filterActiveTasks(pages.flatMap((page) => page.tasks))
      allTasks = activeTasks
      const taskIds = activeTasks.map(task => task.id)
      if (taskIds.length > 0) {
        const sessions = await getLatestSessions(taskIds)
        const updated = new Map($activeSessions)
        for (const session of sessions) {
          updated.set(session.ticket_id, session)
        }
        $activeSessions = updated
      }
    } catch (e) {
      console.error('Failed to load active tasks:', e)
    } finally {
      loading = false
    }
  }
  let sortedAndFiltered = $derived.by(() => {
    const active = filterActiveTasks(allTasks)
    const sorted = sortTasks(active, $activeSessions)
    if (!searchQuery.trim()) return sorted
    return sorted.filter(t => matchesSearch(t, searchQuery.trim(), projectMap))
  })
  let filteredCommands = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) {
      return pluginCommands
    }

    return pluginCommands.filter((command) => {
      const pluginName = $installedPlugins.get(command.pluginId)?.manifest.name ?? command.pluginId
      return command.title.toLowerCase().includes(query)
        || command.contributionId.toLowerCase().includes(query)
        || pluginName.toLowerCase().includes(query)
    })
  })

  type PaletteItem =
    | { key: string; kind: 'command'; pluginId: string; commandId: string; title: string; pluginName: string; shortcut: string | null }
    | { key: string; kind: 'task'; task: TaskDetail }

  let paletteItems = $derived<PaletteItem[]>([
    ...filteredCommands.map((command) => ({
      key: `command:${command.namespacedId}`,
      kind: 'command' as const,
      pluginId: command.pluginId,
      commandId: command.contributionId,
      title: command.title,
      pluginName: $installedPlugins.get(command.pluginId)?.manifest.name ?? command.pluginId,
      shortcut: command.shortcut,
    })),
    ...sortedAndFiltered.map((task) => ({
      key: `task:${task.id}`,
      kind: 'task' as const,
      task,
    })),
  ])

  let selectedIndex = $derived.by(() => {
    if (paletteItems.length === 0) return -1
    if (selectedTaskKey === null) return 0

    const index = paletteItems.findIndex((item) => item.key === selectedTaskKey)
    return index === -1 ? 0 : index
  })

  let lastSearchQuery = $state('')

  $effect(() => {
    const trimmedSearchQuery = searchQuery.trim()

    if (paletteItems.length === 0) {
      selectedTaskKey = null
      lastSearchQuery = trimmedSearchQuery
      return
    }

    const searchChanged = trimmedSearchQuery !== lastSearchQuery
    lastSearchQuery = trimmedSearchQuery

    if (searchChanged || selectedTaskKey === null) {
      selectedTaskKey = paletteItems[0].key
      return
    }

    const selectedTaskStillVisible = paletteItems.some((item) => item.key === selectedTaskKey)

    if (!selectedTaskStillVisible) {
      selectedTaskKey = paletteItems[0].key
    }
  })

  function getSessionStatus(taskId: string): string | null {
    return $activeSessions.get(taskId)?.status ?? null
  }

  function statusLabel(sessionStatus: string | null): string | null {
    switch (sessionStatus) {
      case 'running': return 'Running'
      case 'completed': return 'Done'
      case 'paused': return 'Needs Input'
      case 'failed': return 'Error'
      case 'interrupted': return 'Stopped'
      default: return null
    }
  }

  function statusBadgeVariant(sessionStatus: string | null): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
    switch (sessionStatus) {
      case 'running': return 'success'
      case 'completed': return 'info'
      case 'paused': return 'warning'
      case 'failed': return 'danger'
      default: return 'neutral'
    }
  }

  function selectTask(task: TaskDetail) {
    navigateToTask(task)
    onClose()
  }

  async function selectPluginCommand(pluginId: string, commandId: string) {
    await executePluginCommand(pluginId, commandId)
    onClose()
  }

  let paletteListbox: { handleKeydown: (event: KeyboardEvent) => boolean } | null = $state(null)

  function selectPaletteItem(item: PaletteItem) {
    if (item.kind === 'task') selectTask(item.task)
    else void selectPluginCommand(item.pluginId, item.commandId)
  }

  function handleKeyDown(e: KeyboardEvent): boolean {
    return paletteListbox?.handleKeydown(e) ?? false
  }

  function getProjectName(projectId: string | null): string | null {
    if (!projectId) return null
    return projectMap.get(projectId)?.name ?? null
  }

  function firstLine(text: string): string {
    return text.split('\n')[0]
  }

  function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + '...' : text
  }

  onMount(() => {
    void loadActiveTasks()
  })

</script>

<PaletteModal
  ariaLabel="Search tasks or commands"
  testId="command-palette-backdrop"
  {onClose}
  onKeydown={handleKeyDown}
>
  <PaletteListbox
    bind:this={paletteListbox}
    items={paletteItems}
    {selectedIndex}
    onSelectedIndexChange={(index) => { selectedTaskKey = paletteItems[index]?.key ?? null }}
    onSelect={selectPaletteItem}
    getKey={(item) => item.key}
    idPrefix="command-palette"
    listboxLabel="Tasks and commands"
    {loading}
    onCancel={onClose}
    listClass="max-h-[400px] overflow-y-auto"
    optionClass={(_item, _index, highlighted) => `flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm text-base-content transition-colors ${highlighted ? 'bg-base-300' : 'hover:bg-base-300/60'}`}
  >
    {#snippet input(listboxId, activeDescendantId)}
      <PaletteInput {listboxId} {activeDescendantId} bind:value={searchQuery} placeholder="Search tasks or commands..." />
    {/snippet}
    {#snippet loadingContent()}
      <div class="px-4 py-6 text-center text-base-content/50 text-sm">Loading tasks...</div>
    {/snippet}
    {#snippet emptyContent()}
      <div class="px-4 py-6 text-center text-base-content/50 text-sm">No tasks or commands match your search</div>
    {/snippet}
    {#snippet item(item)}
      {#if item.kind === 'task'}
        {@const sessionStatus = getSessionStatus(item.task.id)}
        {@const label = statusLabel(sessionStatus)}
        {@const badgeVariant = statusBadgeVariant(sessionStatus)}
        {@const projectName = getProjectName(item.task.projectId)}
        {@const isOtherProject = item.task.projectId !== $activeProjectId}
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="font-mono text-xs font-semibold text-primary shrink-0">{item.task.id}</span>
            {#if label}<Badge variant={badgeVariant} class="shrink-0 {sessionStatus === 'paused' ? 'animate-pulse' : ''}">{label}</Badge>{/if}
            {#if projectName && isOtherProject}<Badge variant="neutral" class="shrink-0 opacity-60">{projectName}</Badge>{/if}
          </div>
          <div class="text-xs text-base-content/70 truncate mt-0.5">{truncate(firstLine(item.task.prompt), 80)}</div>
        </div>
        <span class="text-[10px] text-base-content/30 shrink-0">{item.task.status}</span>
      {:else}
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="font-mono text-xs font-semibold text-primary shrink-0">cmd</span>
            <Badge variant="neutral" class="shrink-0 opacity-70">{item.pluginName}</Badge>
            {#if item.shortcut}<Badge variant="neutral" class="shrink-0">{item.shortcut}</Badge>{/if}
          </div>
          <div class="text-xs text-base-content/70 truncate mt-0.5">{item.title}</div>
        </div>
        <span class="text-[10px] text-base-content/30 shrink-0">command</span>
      {/if}
    {/snippet}
  </PaletteListbox>
  <PaletteFooter actionLabel="open or run" trailingKey="Ctrl+N/P" />
</PaletteModal>
