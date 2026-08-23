<script lang="ts">
  import { AlertCircle } from '@lucide/svelte'
  import { installedPlugins } from '../../lib/plugin/pluginStore'
  import GlobalPluginLifecycleControls from './GlobalPluginLifecycleControls.svelte'
  import GlobalPluginSettingsSections from './GlobalPluginSettingsSections.svelte'
  import { pluginSourceLabel } from './globalPluginSettings'

  interface Props {
    activeProjectId?: string | null
    disabled?: boolean
    pluginDefaults?: Map<string, boolean>
    onToggleDefault?: (pluginId: string, enabled: boolean) => void
    onActionError?: (error: string | null) => void
  }

  let {
    activeProjectId = null,
    disabled = false,
    pluginDefaults = new Map(),
    onToggleDefault,
    onActionError,
  }: Props = $props()

  let pluginsList = $derived(Array.from($installedPlugins.values()))
</script>

<div class="flex flex-col gap-4">
  <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Installed Plugins</span>

  {#if pluginsList.length === 0}
    <div class="text-sm text-base-content/50 text-center py-4 border border-dashed border-base-300 rounded-lg">
      No plugins installed
    </div>
  {:else}
    <div class="flex flex-col gap-3">
      {#each pluginsList as plugin (plugin.manifest.id)}
        <div class="flex flex-col gap-3 p-4 border border-base-300 rounded-lg bg-base-200/30">
          <div class="flex items-start justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium text-sm text-base-content">{plugin.manifest.name}</span>
                <span class="text-xs text-base-content/50 font-mono">v{plugin.manifest.version}</span>
                {#if plugin.state === 'active'}
                  <span class="badge badge-success badge-xs">Active</span>
                {:else if plugin.state === 'error'}
                  <span class="badge badge-error badge-xs">Error</span>
                {/if}
              </div>
              <div class="text-xs text-base-content/70">{plugin.manifest.description}</div>
              <div class="text-[10px] text-base-content/50 font-mono break-all">{pluginSourceLabel(plugin)}</div>

              {#if plugin.manifest.permissions && plugin.manifest.permissions.length > 0}
                <div class="flex items-center gap-2 mt-1 flex-wrap">
                  <span class="text-[0.65rem] text-base-content/50 uppercase">Permissions:</span>
                  <div class="flex flex-wrap gap-1">
                    {#each plugin.manifest.permissions as permission}
                      <span class="badge badge-neutral badge-xs opacity-70">{permission}</span>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>

            <GlobalPluginLifecycleControls
              {plugin}
              {activeProjectId}
              {disabled}
              {pluginDefaults}
              {onToggleDefault}
              {onActionError}
            />
          </div>

          {#if plugin.error}
            <div class="mt-2 text-xs text-error bg-error/10 p-2 rounded flex items-start gap-2">
              <AlertCircle size={14} class="shrink-0 mt-0.5" />
              <span class="break-words">{plugin.error}</span>
            </div>
          {/if}

          <GlobalPluginSettingsSections pluginId={plugin.manifest.id} {activeProjectId} />
        </div>
      {/each}
    </div>
  {/if}
</div>
