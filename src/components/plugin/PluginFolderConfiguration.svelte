<script lang="ts">
  import { onMount } from 'svelte'
  import { AlertCircle, FolderOpen } from '@lucide/svelte'
  import { getConfig, selectDirectory, setConfig } from '../../lib/ipc'
  import { pluginActionErrorMessage } from './globalPluginSettings'
  import PluginFolderDiscovery from './PluginFolderDiscovery.svelte'

  const PLUGIN_FOLDER_CONFIG_KEY = 'plugin_folder_path'

  interface Props {
    activeProjectId?: string | null
    disabled?: boolean
    onActionError?: (error: string | null) => void
  }

  let { activeProjectId = null, disabled = false, onActionError }: Props = $props()

  let folderPath = $state<string | null>(null)
  let configurationLoadError = $state<string | null>(null)
  let configurationLoading = $state(false)
  let canScan = $state(false)
  let discoveryBusy = $state(false)

  async function loadFolderConfiguration() {
    if (configurationLoading) return
    configurationLoading = true
    configurationLoadError = null
    try {
      const stored = (await getConfig(PLUGIN_FOLDER_CONFIG_KEY))?.trim() ?? ''
      if (!stored) return
      folderPath = stored
      canScan = true
    } catch (error) {
      configurationLoadError = pluginActionErrorMessage(error)
    } finally {
      configurationLoading = false
    }
  }

  onMount(() => {
    void loadFolderConfiguration()
  })

  async function chooseFolder() {
    if (disabled) return

    onActionError?.(null)
    configurationLoadError = null
    try {
      const selected = await selectDirectory({
        message: 'Choose the folder that holds your OpenForge plugin packages',
        buttonLabel: 'Use folder',
      })
      if (!selected) return

      // Show the selected path immediately, but do not scan until persistence succeeds.
      folderPath = selected
      canScan = false
      await setConfig(PLUGIN_FOLDER_CONFIG_KEY, selected)
      canScan = true
    } catch (error) {
      onActionError?.(pluginActionErrorMessage(error))
    }
  }

  async function removeFolder() {
    if (disabled) return

    onActionError?.(null)
    try {
      await setConfig(PLUGIN_FOLDER_CONFIG_KEY, '')
      folderPath = null
      canScan = false
      discoveryBusy = false
      configurationLoadError = null
    } catch (error) {
      onActionError?.(pluginActionErrorMessage(error))
    }
  }
</script>

{#if configurationLoadError}
  <div class="text-xs text-error bg-error/10 p-2 rounded flex items-start gap-2">
    <AlertCircle size={14} class="shrink-0 mt-0.5" />
    <div class="flex flex-col items-start gap-1">
      <span class="break-words">{configurationLoadError}</span>
      <button
        class="btn btn-ghost btn-xs"
        type="button"
        disabled={disabled || configurationLoading}
        onclick={loadFolderConfiguration}
      >
        Retry loading plugin folder
      </button>
    </div>
  </div>
{/if}

{#if !folderPath}
  <button class="btn btn-primary btn-sm self-start" type="button" {disabled} onclick={chooseFolder}>
    <FolderOpen size={14} />
    Choose plugin folder
  </button>
{:else}
  <div class="flex items-start justify-between gap-3 flex-wrap">
    <span class="text-[10px] text-base-content/60 font-mono break-all min-w-0">{folderPath}</span>
    <button
      class="btn btn-ghost btn-xs shrink-0"
      type="button"
      aria-label="Remove plugin folder"
      disabled={disabled || discoveryBusy}
      onclick={removeFolder}
    >
      Remove
    </button>
  </div>


  <PluginFolderDiscovery
    {folderPath}
    {activeProjectId}
    {disabled}
    autoScan={canScan}
    onBusyChange={(busy) => discoveryBusy = busy}
    {onActionError}
  />
{/if}
