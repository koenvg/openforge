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

  async function handleUninstall() {
    if (disabled) return

    onActionError?.(null)
    try {
      await uninstallPlugin(plugin.manifest.id)
    } catch (error) {
      onActionError?.(pluginActionErrorMessage(error))
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
    <button class="btn btn-error btn-outline btn-xs" type="button" aria-label="Uninstall plugin: {plugin.manifest.name}" {disabled} onclick={handleUninstall}>Uninstall plugin</button>
  {/if}
  <GlobalPluginDiagnostics {plugin} {activeProjectId} {disabled} {onActionError} />
</div>
