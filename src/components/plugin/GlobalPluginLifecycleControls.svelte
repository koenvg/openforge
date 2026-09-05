<script lang="ts">
  import Switch from '@openforge-app/plugin-sdk/ui/Switch.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
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
    <div class="flex items-center gap-2">
      <Switch label="Enabled throughout OpenForge" aria-label="Enabled throughout OpenForge: {plugin.manifest.name}"
        checked={$appEnabledPluginIds.has(plugin.manifest.id)}
        {disabled}
        onchange={(event) => handleAppToggle(event.currentTarget.checked)}
      />
    </div>
  {:else}
    <div class="flex items-center gap-2">
      <Switch label="Enable by default" aria-label="Enable by default: {plugin.manifest.name}"
        data-testid="plugin-default-{plugin.manifest.id}"
        checked={pluginDefaults.get(plugin.manifest.id) ?? false}
        {disabled}
        onchange={(event) => onToggleDefault?.(plugin.manifest.id, event.currentTarget.checked)}
      />
    </div>
  {/if}
  <Button variant="ghost" size="xs" type="button" aria-label="Reload plugin: {plugin.manifest.name}" {disabled} onclick={handleReload}>Reload plugin</Button>
  {#if !isBuiltIn}
    {#if confirmingUninstall}
      <div class="settings-layout flex flex-col items-end gap-1 max-w-48">
        <span class="text-[0.65rem] text-[var(--of-danger)] text-right">This deletes all saved data for this plugin, in every project. It cannot be undone.</span>
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="xs" type="button" disabled={disabled || isUninstalling} onclick={cancelUninstallConfirmation}>Cancel</Button>
          <Button
            variant="danger" size="xs"
            type="button"
            aria-label="Confirm uninstall plugin: {plugin.manifest.name}"
            disabled={disabled || isUninstalling}
            onclick={handleUninstall}
          >
            {isUninstalling ? 'Uninstalling…' : 'Yes, uninstall'}
          </Button>
        </div>
      </div>
    {:else}
      <Button variant="danger" size="xs" type="button" aria-label="Uninstall plugin: {plugin.manifest.name}" {disabled} onclick={beginUninstallConfirmation}>Uninstall plugin</Button>
    {/if}
  {/if}
  <GlobalPluginDiagnostics {plugin} {activeProjectId} {disabled} {onActionError} />
</div>
