<script lang="ts">
  import { onMount } from 'svelte'
  import { AlertCircle, FolderOpen } from '@lucide/svelte'
  import { getConfig, setConfig, selectDirectory, scanPluginFolder, writeClipboardText } from '../../lib/ipc'
  import type { DiscoveredPlugin } from '../../lib/ipc'
  import { installFromLocal, reloadLocalPluginFromDisk } from '../../lib/plugin/pluginRegistry'
  import { installedPlugins } from '../../lib/plugin/pluginStore'

  const PLUGIN_FOLDER_CONFIG_KEY = 'plugin_folder_path'

  interface Props {
    activeProjectId?: string | null
    disabled?: boolean
  }

  let { activeProjectId = null, disabled = false }: Props = $props()

  // A discovered package is offered for install only when the folder is the same one it is
  // already installed from, so a matching plugin id can never silently repoint an install
  // somewhere else on disk.
  type RowStatus = 'installable' | 'installed' | 'outdated' | 'foreign' | 'blocked'

  let folderPath = $state<string | null>(null)
  let discovered = $state<DiscoveredPlugin[]>([])
  let scanError = $state<string | null>(null)
  let actionError = $state<string | null>(null)
  let isScanning = $state(false)
  let isRefreshing = $state(false)
  let busyPluginId = $state<string | null>(null)
  let isInstallingAll = $state(false)

  let rows = $derived.by(() => discovered.map((row) => ({ row, status: rowStatus(row) })))
  let installableRows = $derived(rows.filter(({ status }) => status === 'installable').map(({ row }) => row))
  let isBusy = $derived(isScanning || isRefreshing || isInstallingAll || busyPluginId !== null)

  function normalizePath(path: string | null | undefined): string {
    return (path ?? '').replace(/\/+$/, '')
  }

  function rowStatus(row: DiscoveredPlugin): RowStatus {
    const installed = $installedPlugins.get(row.id)
    if (installed) {
      if (normalizePath(installed.installPath) !== normalizePath(row.path)) return 'foreign'
      return installed.manifest.version === row.version ? 'installed' : 'outdated'
    }
    return row.installable ? 'installable' : 'blocked'
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async function scan() {
    if (!folderPath) return

    isScanning = true
    scanError = null
    try {
      discovered = await scanPluginFolder(folderPath)
    } catch (error) {
      discovered = []
      scanError = errorMessage(error)
    } finally {
      isScanning = false
    }
  }

  onMount(() => {
    void (async () => {
      try {
        const stored = (await getConfig(PLUGIN_FOLDER_CONFIG_KEY))?.trim() ?? ''
        if (!stored) return
        folderPath = stored
        // Scanning on mount means a folder that gained plugins since last time is already
        // listed when the settings page opens, with no refresh click needed.
        await scan()
      } catch (error) {
        scanError = errorMessage(error)
      }
    })()
  })

  async function chooseFolder() {
    if (disabled) return

    actionError = null
    try {
      const selected = await selectDirectory({
        message: 'Choose the folder that holds your OpenForge plugin packages',
        buttonLabel: 'Use folder',
      })
      if (!selected) return

      folderPath = selected
      await setConfig(PLUGIN_FOLDER_CONFIG_KEY, selected)
      await scan()
    } catch (error) {
      actionError = errorMessage(error)
    }
  }

  async function removeFolder() {
    if (disabled) return

    actionError = null
    try {
      await setConfig(PLUGIN_FOLDER_CONFIG_KEY, '')
      folderPath = null
      discovered = []
      scanError = null
    } catch (error) {
      actionError = errorMessage(error)
    }
  }

  async function install(row: DiscoveredPlugin) {
    if (disabled) return

    actionError = null
    busyPluginId = row.id
    try {
      await installFromLocal(row.path, '')
      await scan()
    } catch (error) {
      actionError = errorMessage(error)
    } finally {
      busyPluginId = null
    }
  }

  async function installAll() {
    if (disabled) return

    actionError = null
    isInstallingAll = true
    try {
      // Sequential: each install writes the plugin table and the installed-plugin store.
      for (const row of installableRows) {
        await installFromLocal(row.path, '')
      }
      await scan()
    } catch (error) {
      actionError = errorMessage(error)
    } finally {
      isInstallingAll = false
    }
  }

  async function reload(row: DiscoveredPlugin) {
    if (disabled) return

    actionError = null
    busyPluginId = row.id
    try {
      await reloadLocalPluginFromDisk(row.id, row.path, activeProjectId)
      await scan()
    } catch (error) {
      // Most often the package moved on to something that has not been rebuilt yet, and the
      // sidecar says exactly what is missing. Passing that through beats a button that
      // appears to do nothing.
      actionError = `Could not reload ${row.name}: ${errorMessage(error)}`
    } finally {
      busyPluginId = null
    }
  }

  /**
   * Rescan, then re-apply every package installed from this folder.
   *
   * A rebuild does not have to bump the version, so this cannot be limited to rows that look
   * outdated — it re-reads each one from disk and cycles its runtime, which is what a manual
   * disable/enable in project settings used to be needed for.
   */
  async function refresh() {
    if (disabled || !folderPath) return

    actionError = null
    isRefreshing = true
    try {
      await scan()
      if (scanError) return

      const installedHere = discovered.filter((row) => {
        const status = rowStatus(row)
        return status === 'installed' || status === 'outdated'
      })
      if (installedHere.length === 0) return

      const failures: string[] = []
      // Sequential: each reload rewrites the plugin table and cycles a runtime.
      for (const row of installedHere) {
        try {
          await reloadLocalPluginFromDisk(row.id, row.path, activeProjectId)
        } catch (error) {
          failures.push(`Could not reload ${row.name}: ${errorMessage(error)}`)
        }
      }

      if (failures.length > 0) actionError = failures.join('\n')
      await scan()
    } finally {
      isRefreshing = false
    }
  }

  async function copyBuildCommand(row: DiscoveredPlugin) {
    if (disabled) return

    actionError = null
    try {
      await writeClipboardText(`pnpm -C ${row.path} build`)
    } catch (error) {
      actionError = `Failed to copy the build command: ${errorMessage(error)}`
    }
  }
</script>

<div class="flex flex-col gap-3 p-4 border border-base-300 rounded-lg bg-base-200/30">
  <div class="flex flex-col gap-1">
    <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Plugin folder</span>
    <p class="text-xs text-base-content/60 m-0">
      Point OpenForge at a folder of plugin packages to install any of them in one click. Refresh picks up
      new packages and reloads the ones already installed from here, so a rebuild reaches every project.
    </p>
  </div>

  {#if !folderPath}
    <button class="btn btn-primary btn-sm self-start" type="button" {disabled} onclick={chooseFolder}>
      <FolderOpen size={14} />
      Choose plugin folder
    </button>
  {:else}
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <span class="text-[10px] text-base-content/60 font-mono break-all min-w-0">{folderPath}</span>
      <div class="flex items-center gap-2 shrink-0">
        {#if installableRows.length > 1}
          <button
            class="btn btn-primary btn-xs"
            type="button"
            disabled={disabled || isBusy}
            onclick={installAll}
          >
            {isInstallingAll ? 'Installing…' : `Install all available (${installableRows.length})`}
          </button>
        {/if}
        <button
          class="btn btn-ghost btn-xs"
          type="button"
          aria-label="Refresh plugin folder"
          disabled={disabled || isBusy}
          onclick={refresh}
        >
          {isScanning || isRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          class="btn btn-ghost btn-xs"
          type="button"
          aria-label="Remove plugin folder"
          disabled={disabled || isBusy}
          onclick={removeFolder}
        >
          Remove
        </button>
      </div>
    </div>

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

    {#each rows as { row, status } (row.path)}
      {@const showsProblem = status !== 'installed' && status !== 'outdated'}
      <div class="flex items-start justify-between gap-4 p-3 border border-base-300 rounded-lg">
        <div class="flex flex-col gap-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium text-sm text-base-content">{row.name}</span>
            <span class="text-xs text-base-content/50 font-mono">v{row.version}</span>
            {#if status === 'installed'}
              <span class="badge badge-success badge-xs">Installed</span>
            {:else if status === 'outdated'}
              <span class="badge badge-warning badge-xs">Update available</span>
            {:else if status === 'foreign'}
              <span class="badge badge-neutral badge-xs">Installed from another folder</span>
            {:else if row.needsBuild}
              <span class="badge badge-warning badge-xs">Needs build</span>
            {:else if !row.installable}
              <span class="badge badge-error badge-xs">Cannot install</span>
            {/if}
          </div>
          <div class="text-xs text-base-content/70">{row.description}</div>
          <div class="text-[10px] text-base-content/50 font-mono break-all">{row.path}</div>

          {#if row.problem && showsProblem}
            <div class="mt-1 text-xs text-error bg-error/10 p-2 rounded flex items-start gap-2">
              <AlertCircle size={14} class="shrink-0 mt-0.5" />
              <span class="break-words">{row.problem}</span>
            </div>
          {/if}
        </div>

        <div class="flex flex-col items-end gap-2 shrink-0">
          {#if status === 'installable'}
            <button
              class="btn btn-primary btn-xs"
              type="button"
              aria-label="Install plugin: {row.name}"
              disabled={disabled || isBusy}
              onclick={() => install(row)}
            >
              {busyPluginId === row.id ? 'Installing…' : 'Install'}
            </button>
          {:else if status === 'installed' || status === 'outdated'}
            <button
              class="btn btn-ghost btn-xs"
              type="button"
              aria-label="Reload plugin: {row.name}"
              disabled={disabled || isBusy}
              onclick={() => reload(row)}
            >
              {busyPluginId === row.id ? 'Reloading…' : 'Reload'}
            </button>
          {/if}

          {#if row.needsBuild && showsProblem}
            <button
              class="btn btn-ghost btn-xs"
              type="button"
              aria-label="Copy build command: {row.name}"
              disabled={disabled}
              onclick={() => copyBuildCommand(row)}
            >
              Copy build command
            </button>
          {/if}
        </div>
      </div>
    {/each}
  {/if}

  {#if actionError}
    <div class="text-xs text-error bg-error/10 p-2 rounded flex items-start gap-2">
      <AlertCircle size={14} class="shrink-0 mt-0.5" />
      <!-- A refresh can fail for more than one package, so each failure keeps its own line. -->
      <span class="break-words whitespace-pre-line">{actionError}</span>
    </div>
  {/if}
</div>
