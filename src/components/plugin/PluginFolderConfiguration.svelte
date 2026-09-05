<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
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
  <Panel padding="none" variant="subtle">
    <div role="alert" class="text-xs text-[var(--of-danger)] p-2 flex items-start gap-2">
      <AlertCircle size={14} class="shrink-0 mt-0.5" />
      <div class="flex flex-col items-start gap-1">
        <span class="break-words">{configurationLoadError}</span>
        <Button
          variant="ghost" size="xs"
          type="button"
          disabled={disabled || configurationLoading}
          onclick={loadFolderConfiguration}
        >
          Retry loading plugin folder
        </Button>
      </div>
    </div>
  </Panel>
{/if}

{#if !folderPath}
  <Button variant="primary" size="sm" class="self-start" type="button" {disabled} onclick={chooseFolder}>
    <FolderOpen size={14} />
    Choose plugin folder
  </Button>
{:else}
  <div class="flex items-start justify-between gap-3 flex-wrap">
    <span class="plugin-folder-path text-xs text-[var(--of-text-secondary)] font-mono break-all min-w-0">{folderPath}</span>
    <Button
      variant="ghost" size="xs" class="shrink-0"
      type="button"
      aria-label="Remove plugin folder"
      disabled={disabled || discoveryBusy}
      onclick={removeFolder}
    >
      Remove
    </Button>
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
