<script lang="ts">
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import Switch from '@openforge-app/plugin-sdk/ui/Switch.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import { AlertCircle, Blocks } from '@lucide/svelte'
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

  let pluginsList = $derived(Array.from($installedPlugins.values()).filter((plugin) => plugin.packageMetadata?.enablement !== 'app'))
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

  function statusVariant(plugin: PluginEntry, isEnabled: boolean): 'danger' | 'success' | 'neutral' {
    if (hasPluginAttention(plugin)) return 'danger'
    return isEnabled ? 'success' : 'neutral'
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
    <Badge variant="success">{enabledCount} enabled</Badge>
    {#if attentionCount > 0}
      <Badge variant="danger">{attentionCount} needs attention</Badge>
    {/if}
    <Badge variant="neutral">{disabledCount} disabled</Badge>
  {/snippet}
  <div class="flex flex-col gap-4">
    <p class="m-0 text-xs text-[var(--of-text-muted)]">Plugin enablement inherits your global plugin defaults; changes here apply to this project only.</p>
    <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div class="flex items-center gap-2 xl:w-80">
        <TextField label="Search plugins"
          type="search"
          class="grow"
          placeholder="Search plugins"
          bind:value={searchQuery}
          disabled={disabled}
        />
      </div>

      <div class="flex flex-wrap gap-2" aria-label="Plugin filters">
        <Button type="button" variant={activeFilter === 'all' ? 'primary' : 'outline'} size="xs" onclick={() => setFilter('all')} disabled={disabled}>All</Button>
        <Button type="button" variant={activeFilter === 'enabled' ? 'primary' : 'outline'} size="xs" onclick={() => setFilter('enabled')} disabled={disabled}>Enabled</Button>
        <Button type="button" variant={activeFilter === 'disabled' ? 'primary' : 'outline'} size="xs" onclick={() => setFilter('disabled')} disabled={disabled}>Disabled</Button>
        <Button type="button" variant={activeFilter === 'attention' ? 'primary' : 'outline'} size="xs" onclick={() => setFilter('attention')} disabled={disabled}>Needs attention</Button>
      </div>
    </div>

    {#if $pluginLoadError}
      <Panel padding="none" variant="subtle">
        <div class="text-xs text-[var(--of-danger)] p-3 flex items-start gap-2">
        <AlertCircle size={14} class="shrink-0 mt-0.5" />
        <span class="break-words">{$pluginLoadError}</span>
      </div>
      </Panel>
    {/if}

    {#if actionError}
      <Panel padding="none" variant="subtle">
        <div class="text-xs text-[var(--of-danger)] p-3 flex items-start gap-2">
        <AlertCircle size={14} class="shrink-0 mt-0.5" />
        <span class="break-words">{actionError}</span>
      </div>
      </Panel>
    {/if}

    {#if pluginsList.length === 0}
      <Panel padding="none" variant="subtle">
        <div class="text-sm text-[var(--of-text-muted)] text-center py-8">
        No project-enabled plugins installed
      </div>
      </Panel>
    {:else if filteredPlugins.length === 0}
      <Panel padding="none" variant="subtle">
        <div class="text-sm text-[var(--of-text-muted)] text-center py-8">
        No plugins match the current search or filter
      </div>
      </Panel>
    {:else}
      <Panel padding="none" variant="subtle">
        <div class="overflow-hidden">
        {#each filteredPlugins as plugin (plugin.manifest.id)}
          {@const isEnabled = $enabledPluginIds.has(plugin.manifest.id)}
          <div class="grid gap-3 border-b border-[var(--of-border)] p-4 transition-colors last:border-b-0 hover:bg-[var(--of-surface-subtle)] md:grid-cols-[3rem_minmax(0,1fr)_5rem_8rem] md:items-center">
            <div class="flex items-center justify-start md:justify-center">
              <Switch hideLabel label="{isEnabled ? 'Disable' : 'Enable'} for this project: {plugin.manifest.name}"
                checked={isEnabled}
                disabled={disabled}
                onchange={() => handleToggle(plugin.manifest.id, isEnabled)}
              />
            </div>

            <div class="settings-layout min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium text-[var(--of-text)]">{plugin.manifest.name}</span>
                <Badge variant="neutral" class="ml-auto md:hidden">{statusLabel(plugin, isEnabled)}</Badge>
              </div>
              <p class="m-0 mt-1 text-sm leading-6 text-[var(--of-text-secondary)]">{plugin.manifest.description}</p>
              {#if plugin.error}
                <Panel padding="none" variant="subtle">
                  <div class="mt-2 flex flex-wrap items-center gap-2 px-2 py-1.5 text-xs text-[var(--of-danger)]">
                  <AlertCircle size={14} class="shrink-0" />
                  <span class="break-words">{plugin.error}</span>
                </div>
                </Panel>
              {/if}
            </div>

            <div class="text-xs font-mono text-[var(--of-text-muted)] md:justify-self-end md:text-right">v{plugin.manifest.version}</div>

            <div class="hidden md:block md:justify-self-end">
              <Badge variant={statusVariant(plugin, isEnabled)}>{statusLabel(plugin, isEnabled)}</Badge>
            </div>
          </div>
        {/each}
      </div>
      </Panel>
    {/if}
  </div>
</SettingsSectionCard>
