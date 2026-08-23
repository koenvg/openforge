<script lang="ts">
  import { onDestroy } from 'svelte'
  import { AlertCircle } from '@lucide/svelte'
  import { scanPluginFolder } from '../../lib/ipc'
  import type { DiscoveredPlugin } from '../../lib/ipc'
  import { pluginActionErrorMessage } from './globalPluginSettings'
  import PluginFolderPackages from './PluginFolderPackages.svelte'

  interface Props {
    folderPath: string
    autoScan?: boolean
    activeProjectId?: string | null
    disabled?: boolean
    onBusyChange?: (busy: boolean) => void
    onActionError?: (error: string | null) => void
  }

  let {
    folderPath,
    autoScan = true,
    activeProjectId = null,
    disabled = false,
    onBusyChange,
    onActionError,
  }: Props = $props()

  let discovered = $state<DiscoveredPlugin[]>([])
  let scanError = $state<string | null>(null)
  let isScanning = $state(false)
  let packagesBusy = $state(false)
  let hasAutoScanned = false
  let isBusy = $derived(isScanning || packagesBusy)

  $effect(() => {
    onBusyChange?.(isBusy)
  })

  onDestroy(() => {
    onBusyChange?.(false)
  })

  async function scan(): Promise<DiscoveredPlugin[] | null> {
    isScanning = true
    scanError = null
    try {
      const rows = await scanPluginFolder(folderPath)
      discovered = rows
      return rows
    } catch (error) {
      discovered = []
      scanError = pluginActionErrorMessage(error)
      return null
    } finally {
      isScanning = false
    }
  }

  $effect(() => {
    if (!autoScan || hasAutoScanned) return
    hasAutoScanned = true
    // Scan once configuration loading or persistence has made this folder ready.
    void scan()
  })
</script>

<PluginFolderPackages
  {discovered}
  {activeProjectId}
  {disabled}
  {isScanning}
  onScan={scan}
  onBusyChange={(busy) => packagesBusy = busy}
  {onActionError}
/>

{#if scanError}
  <div class="text-xs text-error bg-error/10 p-2 rounded flex items-start gap-2">
    <AlertCircle size={14} class="shrink-0 mt-0.5" />
    <span class="break-words">{scanError}</span>
  </div>
{/if}

{#if discovered.length === 0 && !scanError && !isScanning}
  <div class="text-sm text-base-content/50 text-center py-4 border border-dashed border-base-300 rounded-lg">
    No plugin packages found in this folder
  </div>
{/if}
