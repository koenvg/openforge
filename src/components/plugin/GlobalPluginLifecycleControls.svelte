<script lang="ts">
  import {
    disablePluginForApp,
    enablePluginForApp,
    reloadInstalledPluginMetadata,
    reloadPluginForApp,
    reloadPluginForProject,
    uninstallPlugin,
  } from '../../lib/plugin/pluginRegistry'
  import { appEnabledPluginIds } from '../../lib/plugin/pluginStore'
  import type { PluginEntry } from '../../lib/plugin/types'
  import GlobalPluginDiagnostics from './GlobalPluginDiagnostics.svelte'
  import { isBuiltInPlugin, pluginActionErrorMessage } from './globalPluginSettings'

  interface Props {
    plugin: PluginEntry
    activeProjectId?: string | null
    disabled?: boolean
    pluginDefaults?: Map<string, boolean>
    onToggleDefault?: (pluginId: string, enabled: boolean) => void
    onActionError?: (error: string | null) => void
  }

  let {
    plugin,
    activeProjectId = null,
    disabled = false,
    pluginDefaults = new Map(),
    onToggleDefault,
    onActionError,
  }: Props = $props()

  let usesAppEnablement = $derived(plugin.packageMetadata?.enablement === 'app')
  let isBuiltIn = $derived(isBuiltInPlugin(plugin))

  async function handleAppToggle(enabled: boolean) {
    if (disabled) return

    onActionError?.(null)
    try {
      if (enabled) await enablePluginForApp(plugin.manifest.id)
      else await disablePluginForApp(plugin.manifest.id)
    } catch (error) {
      onActionError?.(pluginActionErrorMessage(error))
    }
  }

  async function handleReload() {
    if (disabled) return

    onActionError?.(null)
    try {
      if (usesAppEnablement) {
        await reloadPluginForApp(plugin.manifest.id)
      } else if (activeProjectId) {
        await reloadPluginForProject(activeProjectId, plugin.manifest.id)
      } else {
        await reloadInstalledPluginMetadata(plugin.manifest.id)
      }
    } catch (error) {
      onActionError?.(pluginActionErrorMessage(error))
    }
  }

  let confirmingUninstall = $state(false)
  let isUninstalling = $state(false)

  function beginUninstallConfirmation() {
    if (disabled) return
    onActionError?.(null)
    confirmingUninstall = true
  }

  function cancelUninstallConfirmation() {
    confirmingUninstall = false
  }

  async function handleUninstall() {
    if (disabled) return

    onActionError?.(null)
    isUninstalling = true
    try {
      // Uninstalling deletes the plugin's database row. plugin_storage has an
      // ON DELETE CASCADE foreign key on that row, so this also erases every value
      // the plugin has saved — global settings and every project's data. There is
      // no way to undo it, so the button flow must ask first (AVIV-404).
      await uninstallPlugin(plugin.manifest.id)
    } catch (error) {
      onActionError?.(pluginActionErrorMessage(error))
    } finally {
      isUninstalling = false
      confirmingUninstall = false
    }
  }
</script>

<div class="flex flex-col items-end gap-2 shrink-0">
  {#if usesAppEnablement}
    <label class="flex items-center gap-2 cursor-pointer">
      <span class="text-xs text-base-content/70">Enabled throughout OpenForge</span>
      <input
        type="checkbox"
        class="toggle toggle-primary toggle-sm"
        role="switch"
        aria-label="Enabled throughout OpenForge: {plugin.manifest.name}"
        checked={$appEnabledPluginIds.has(plugin.manifest.id)}
        {disabled}
        onchange={(event) => handleAppToggle(event.currentTarget.checked)}
      />
    </label>
  {:else}
    <label class="flex items-center gap-2 cursor-pointer">
      <span class="text-xs text-base-content/70">Enable by default</span>
      <input
        type="checkbox"
        class="toggle toggle-primary toggle-sm"
        role="switch"
        aria-label="Enable by default: {plugin.manifest.name}"
        data-testid="plugin-default-{plugin.manifest.id}"
        checked={pluginDefaults.get(plugin.manifest.id) ?? false}
        {disabled}
        onchange={(event) => onToggleDefault?.(plugin.manifest.id, event.currentTarget.checked)}
      />
    </label>
  {/if}
  <button class="btn btn-ghost btn-xs" type="button" aria-label="Reload plugin: {plugin.manifest.name}" {disabled} onclick={handleReload}>Reload plugin</button>
  {#if !isBuiltIn}
    {#if confirmingUninstall}
      <div class="flex flex-col items-end gap-1 max-w-48">
        <span class="text-[0.65rem] text-error text-right">This deletes all saved data for this plugin, in every project. It cannot be undone.</span>
        <div class="flex items-center gap-2">
          <button class="btn btn-ghost btn-xs" type="button" disabled={disabled || isUninstalling} onclick={cancelUninstallConfirmation}>Cancel</button>
          <button
            class="btn btn-error btn-xs"
            type="button"
            aria-label="Confirm uninstall plugin: {plugin.manifest.name}"
            disabled={disabled || isUninstalling}
            onclick={handleUninstall}
          >
            {isUninstalling ? 'Uninstalling…' : 'Yes, uninstall'}
          </button>
        </div>
      </div>
    {:else}
      <button class="btn btn-error btn-outline btn-xs" type="button" aria-label="Uninstall plugin: {plugin.manifest.name}" {disabled} onclick={beginUninstallConfirmation}>Uninstall plugin</button>
    {/if}
  {/if}
  <GlobalPluginDiagnostics {plugin} {activeProjectId} {disabled} {onActionError} />
</div>
