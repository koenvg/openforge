<script lang="ts">
  import { AlertCircle, Blocks, Search } from '@lucide/svelte'
  import {
    installedPlugins,
    enabledPluginIds,
    error as pluginLoadError,
  } from '../../lib/plugin/pluginStore'
  import {
    disablePluginForProject,
    enablePluginForProject,
  } from '../../lib/plugin/pluginRegistry'
  import type { PluginEntry } from '../../lib/plugin/types'
  import SettingsSectionCard from '../settings/SettingsSectionCard.svelte'

  interface Props {
    projectId: string
    disabled?: boolean
  }

  type PluginFilter = 'all' | 'enabled' | 'disabled' | 'attention'

  let {
    projectId,
    disabled = false
  }: Props = $props()

  let actionError = $state<string | null>(null)
  let searchQuery = $state('')
  let activeFilter = $state<PluginFilter>('all')

  let pluginsList = $derived(Array.from($installedPlugins.values()))
  let enabledCount = $derived(pluginsList.filter((plugin) => $enabledPluginIds.has(plugin.manifest.id)).length)
  let disabledCount = $derived(pluginsList.length - enabledCount)
  let attentionCount = $derived(pluginsList.filter(hasPluginAttention).length)
  let filteredPlugins = $derived(pluginsList.filter((plugin) => matchesSearch(plugin) && matchesFilter(plugin)))

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function hasPluginAttention(plugin: PluginEntry): boolean {
    return plugin.state === 'error' || !!plugin.error
  }

  function matchesSearch(plugin: PluginEntry): boolean {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return true

    return [plugin.manifest.name, plugin.manifest.description, plugin.manifest.version]
      .some((value) => value.toLowerCase().includes(query))
  }

  function matchesFilter(plugin: PluginEntry): boolean {
    if (activeFilter === 'enabled') return $enabledPluginIds.has(plugin.manifest.id)
    if (activeFilter === 'disabled') return !$enabledPluginIds.has(plugin.manifest.id)
    if (activeFilter === 'attention') return hasPluginAttention(plugin)
    return true
  }

  function statusLabel(plugin: PluginEntry, isEnabled: boolean): string {
    if (hasPluginAttention(plugin)) return 'Needs attention'
    return isEnabled ? 'Enabled' : 'Disabled'
  }

  function statusClass(plugin: PluginEntry, isEnabled: boolean): string {
    if (hasPluginAttention(plugin)) return 'badge-error'
    return isEnabled ? 'badge-success' : 'badge-ghost'
  }

  function setFilter(filter: PluginFilter) {
    activeFilter = filter
  }

  async function handleToggle(pluginId: string, isEnabled: boolean) {
    if (disabled) return

    actionError = null
    try {
      if (isEnabled) {
        await disablePluginForProject(projectId, pluginId)
      } else {
        await enablePluginForProject(projectId, pluginId)
      }
    } catch (error) {
      actionError = errorMessage(error)
    }
  }
</script>

<SettingsSectionCard
  id="section-plugins"
  title="Project plugins"
  description="Enable installed plugins for this project."
  {disabled}
>
  {#snippet icon()}<Blocks size={18} />{/snippet}
  {#snippet actions()}
    <span class="badge badge-success badge-outline">{enabledCount} enabled</span>
    {#if attentionCount > 0}
      <span class="badge badge-error badge-outline">{attentionCount} needs attention</span>
    {/if}
    <span class="badge badge-ghost">{disabledCount} disabled</span>
  {/snippet}
  <div class="flex flex-col gap-4">
    <p class="m-0 text-xs text-base-content/50">Plugin enablement inherits your global plugin defaults; changes here apply to this project only.</p>
    <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <label class="input input-bordered input-sm flex items-center gap-2 xl:w-80">
        <Search size={16} class="text-base-content/50" />
        <input
          type="search"
          class="grow"
          aria-label="Search plugins"
          placeholder="Search plugins"
          bind:value={searchQuery}
          disabled={disabled}
        />
      </label>

      <div class="flex flex-wrap gap-2" aria-label="Plugin filters">
        <button type="button" class="btn btn-xs {activeFilter === 'all' ? 'btn-primary' : 'btn-outline'}" onclick={() => setFilter('all')} disabled={disabled}>All</button>
        <button type="button" class="btn btn-xs {activeFilter === 'enabled' ? 'btn-primary' : 'btn-outline'}" onclick={() => setFilter('enabled')} disabled={disabled}>Enabled</button>
        <button type="button" class="btn btn-xs {activeFilter === 'disabled' ? 'btn-primary' : 'btn-outline'}" onclick={() => setFilter('disabled')} disabled={disabled}>Disabled</button>
        <button type="button" class="btn btn-xs {activeFilter === 'attention' ? 'btn-primary' : 'btn-outline'}" onclick={() => setFilter('attention')} disabled={disabled}>Needs attention</button>
      </div>
    </div>

    {#if $pluginLoadError}
      <div class="text-xs text-error bg-error/10 p-3 rounded flex items-start gap-2">
        <AlertCircle size={14} class="shrink-0 mt-0.5" />
        <span class="break-words">{$pluginLoadError}</span>
      </div>
    {/if}

    {#if actionError}
      <div class="text-xs text-error bg-error/10 p-3 rounded flex items-start gap-2">
        <AlertCircle size={14} class="shrink-0 mt-0.5" />
        <span class="break-words">{actionError}</span>
      </div>
    {/if}

    {#if pluginsList.length === 0}
      <div class="text-sm text-base-content/50 text-center py-8 border border-dashed border-base-300 rounded-lg">
        No plugins installed app-wide
      </div>
    {:else if filteredPlugins.length === 0}
      <div class="text-sm text-base-content/50 text-center py-8 border border-dashed border-base-300 rounded-lg">
        No plugins match the current search or filter
      </div>
    {:else}
      <div class="overflow-hidden rounded-lg border border-base-300 bg-base-100">
        {#each filteredPlugins as plugin (plugin.manifest.id)}
          {@const isEnabled = $enabledPluginIds.has(plugin.manifest.id)}
          <div class="grid gap-3 border-b border-base-300/70 p-4 transition-colors last:border-b-0 hover:bg-base-200/30 md:grid-cols-[3rem_minmax(0,1fr)_5rem_8rem] md:items-center">
            <label class="flex min-h-11 items-center justify-start md:justify-center">
              <input
                type="checkbox"
                role="switch"
                class="toggle toggle-primary toggle-sm"
                aria-label="{isEnabled ? 'Disable' : 'Enable'} for this project: {plugin.manifest.name}"
                checked={isEnabled}
                disabled={disabled}
                onchange={() => handleToggle(plugin.manifest.id, isEnabled)}
              />
            </label>

            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium text-base-content">{plugin.manifest.name}</span>
                <span class="badge badge-ghost badge-xs ml-auto md:hidden">{statusLabel(plugin, isEnabled)}</span>
              </div>
              <p class="m-0 mt-1 text-sm leading-6 text-base-content/65">{plugin.manifest.description}</p>
              {#if plugin.error}
                <div class="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-error/10 px-2 py-1.5 text-xs text-error">
                  <AlertCircle size={14} class="shrink-0" />
                  <span class="break-words">{plugin.error}</span>
                </div>
              {/if}
            </div>

            <div class="text-xs font-mono text-base-content/50 md:justify-self-end md:text-right">v{plugin.manifest.version}</div>

            <div class="hidden md:block md:justify-self-end">
              <span class="badge badge-sm {statusClass(plugin, isEnabled)}">{statusLabel(plugin, isEnabled)}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</SettingsSectionCard>
