<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import { onDestroy } from 'svelte'
  import { AlertCircle } from '@lucide/svelte'
  import { writeClipboardText } from '../../lib/ipc'
  import type { DiscoveredPlugin } from '../../lib/ipc'
  import { installFromLocal, reloadLocalPluginFromDisk } from '../../lib/plugin/pluginRegistry'
  import { installedPlugins } from '../../lib/plugin/pluginStore'
  import { pluginActionErrorMessage } from './globalPluginSettings'

  type RowStatus = 'installable' | 'installed' | 'outdated' | 'foreign' | 'blocked'

  interface Props {
    discovered: DiscoveredPlugin[]
    activeProjectId?: string | null
    disabled?: boolean
    isScanning?: boolean
    onScan: () => Promise<DiscoveredPlugin[] | null>
    onBusyChange?: (busy: boolean) => void
    onActionError?: (error: string | null) => void
  }

  let {
    discovered,
    activeProjectId = null,
    disabled = false,
    isScanning = false,
    onScan,
    onBusyChange,
    onActionError,
  }: Props = $props()

  let busyPluginId = $state<string | null>(null)
  let isInstallingAll = $state(false)
  let isRefreshing = $state(false)

  let rows = $derived.by(() => discovered.map((row) => ({ row, status: rowStatus(row) })))
  let installableRows = $derived(rows.filter(({ status }) => status === 'installable').map(({ row }) => row))
  let isBusy = $derived(isScanning || isRefreshing || isInstallingAll || busyPluginId !== null)

  $effect(() => {
    onBusyChange?.(isBusy)
  })

  onDestroy(() => {
    onBusyChange?.(false)
  })

  function normalizePath(path: string | null | undefined): string {
    return (path ?? '').replace(/\/+$/, '')
  }

  // A matching plugin id at a different path is flagged 'foreign' instead of being reloaded
  // automatically — refresh() below skips it, so a package that merely happens to share an id
  // cannot silently repoint the existing installation. Repointing still works, but only through
  // the explicit "Load from this folder" action the user clicks on that row.
  function rowStatus(row: DiscoveredPlugin): RowStatus {
    const installed = $installedPlugins.get(row.id)
    if (installed) {
      if (normalizePath(installed.installPath) !== normalizePath(row.path)) return 'foreign'
      return installed.manifest.version === row.version ? 'installed' : 'outdated'
    }
    return row.installable ? 'installable' : 'blocked'
  }

  async function install(row: DiscoveredPlugin) {
    if (disabled) return

    onActionError?.(null)
    busyPluginId = row.id
    try {
      await installFromLocal(row.path, '')
      await onScan()
    } catch (error) {
      onActionError?.(pluginActionErrorMessage(error))
    } finally {
      busyPluginId = null
    }
  }

  async function installAll() {
    if (disabled) return

    onActionError?.(null)
    isInstallingAll = true
    try {
      // Registry writes stay sequential so each install updates the plugin table and store before
      // the next package starts.
      for (const row of installableRows) {
        await installFromLocal(row.path, '')
      }
      await onScan()
    } catch (error) {
      onActionError?.(pluginActionErrorMessage(error))
    } finally {
      isInstallingAll = false
    }
  }

  async function reload(row: DiscoveredPlugin) {
    if (disabled) return

    onActionError?.(null)
    busyPluginId = row.id
    try {
      await reloadLocalPluginFromDisk(row.id, row.path, activeProjectId)
      await onScan()
    } catch (error) {
      onActionError?.(`Could not reload ${row.name}: ${pluginActionErrorMessage(error)}`)
    } finally {
      busyPluginId = null
    }
  }

  async function refresh() {
    if (disabled) return

    onActionError?.(null)
    isRefreshing = true
    try {
      const refreshed = await onScan()
      if (!refreshed) return

      const installedHere = refreshed.filter((row) => {
        const status = rowStatus(row)
        return status === 'installed' || status === 'outdated'
      })
      if (installedHere.length === 0) return

      const failures: string[] = []
      // Reloads stay sequential because each one rewrites the plugin table and cycles a runtime.
      for (const row of installedHere) {
        try {
          await reloadLocalPluginFromDisk(row.id, row.path, activeProjectId)
        } catch (error) {
          failures.push(`Could not reload ${row.name}: ${pluginActionErrorMessage(error)}`)
        }
      }

      if (failures.length > 0) onActionError?.(failures.join('\n'))
      await onScan()
    } finally {
      isRefreshing = false
    }
  }

  async function copyBuildCommand(row: DiscoveredPlugin) {
    if (disabled) return

    onActionError?.(null)
    try {
      await writeClipboardText(`pnpm -C ${row.path} build`)
    } catch (error) {
      onActionError?.(`Failed to copy the build command: ${pluginActionErrorMessage(error)}`)
    }
  }
</script>

<div class="flex items-center justify-end gap-2 flex-wrap">
  {#if installableRows.length > 1}
    <Button
      variant="primary" size="xs"
      type="button"
      disabled={disabled || isBusy}
      onclick={installAll}
    >
      {isInstallingAll ? 'Installing…' : `Install all available (${installableRows.length})`}
    </Button>
  {/if}
  <Button
    variant="ghost" size="xs"
    type="button"
    aria-label="Refresh plugin folder"
    disabled={disabled || isBusy}
    onclick={refresh}
  >
    {isScanning || isRefreshing ? 'Refreshing…' : 'Refresh'}
  </Button>
</div>

{#each rows as { row, status } (row.path)}
  {@const showsProblem = status !== 'installed' && status !== 'outdated'}
  <Panel>
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="plugin-metadata flex flex-col gap-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-medium text-sm text-[var(--of-text)]">{row.name}</span>
          <span class="text-xs text-[var(--of-text-muted)] font-mono">v{row.version}</span>
          {#if status === 'installed'}
            <Badge variant="success">Installed</Badge>
          {:else if status === 'outdated'}
            <Badge variant="warning">Update available</Badge>
          {:else if status === 'foreign'}
            <Badge>Installed from another folder</Badge>
          {:else if row.needsBuild}
            <Badge variant="warning">Needs build</Badge>
          {:else if !row.installable}
            <Badge variant="danger">Cannot install</Badge>
          {/if}
        </div>
        <div class="text-xs text-[var(--of-text-secondary)]">{row.description}</div>
        <div class="text-xs text-[var(--of-text-muted)] font-mono break-all">{row.path}</div>

        {#if row.problem && showsProblem}
          <Panel padding="none" variant="subtle">
            <div role="alert" class="text-xs text-[var(--of-danger)] p-2 flex items-start gap-2">
              <AlertCircle size={14} class="shrink-0 mt-0.5" />
              <span class="break-words">{row.problem}</span>
            </div>
          </Panel>
        {/if}
      </div>

      <div class="flex flex-col items-end gap-2 shrink-0">
        {#if status === 'installable'}
          <Button
            variant="primary" size="xs"
            type="button"
            aria-label="Install plugin: {row.name}"
            disabled={disabled || isBusy}
            onclick={() => install(row)}
          >
            {busyPluginId === row.id ? 'Installing…' : 'Install'}
          </Button>
        {:else if status === 'installed' || status === 'outdated'}
          <Button
            variant="ghost" size="xs"
            type="button"
            aria-label="Reload plugin: {row.name}"
            disabled={disabled || isBusy}
            onclick={() => reload(row)}
          >
            {busyPluginId === row.id ? 'Reloading…' : 'Reload'}
          </Button>
        {:else if status === 'foreign'}
          <Button
            variant="ghost" size="xs"
            type="button"
            aria-label="Load plugin from this folder: {row.name}"
            disabled={disabled || isBusy}
            onclick={() => reload(row)}
          >
            {busyPluginId === row.id ? 'Loading…' : 'Load from this folder'}
          </Button>
        {/if}

        {#if row.needsBuild && showsProblem}
          <Button
            variant="ghost" size="xs"
            type="button"
            aria-label="Copy build command: {row.name}"
            disabled={disabled}
            onclick={() => copyBuildCommand(row)}
          >
            Copy build command
          </Button>
        {/if}
      </div>
    </div>
  </Panel>
{/each}
