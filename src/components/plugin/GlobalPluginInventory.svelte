<script lang="ts">
  import { AlertCircle } from '@lucide/svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import { installedPlugins } from '../../lib/plugin/pluginStore'
  import { availableThemes } from '../../lib/theme'
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
  <span class="text-xs text-[var(--of-text-muted)] uppercase tracking-wider">Installed Plugins</span>

  {#if pluginsList.length === 0}
    <Panel variant="subtle">
      <div class="text-sm text-[var(--of-text-muted)] text-center py-4">No plugins installed</div>
    </Panel>
  {:else}
    <div class="flex flex-col gap-3">
      {#each pluginsList as plugin (plugin.manifest.id)}
        {@const themes = $availableThemes.filter(theme => theme.owner.kind === 'plugin' && theme.owner.pluginId === plugin.manifest.id)}
        <Panel variant="subtle">
          <div class="flex flex-col gap-3">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div class="plugin-metadata flex flex-col gap-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium text-sm text-[var(--of-text)]">{plugin.manifest.name}</span>
                  <span class="text-xs text-[var(--of-text-muted)] font-mono">v{plugin.manifest.version}</span>
                  {#if plugin.state === 'active'}
                    <Badge variant="success">Active</Badge>
                  {:else if plugin.state === 'error'}
                    <Badge variant="danger">Error</Badge>
                  {/if}
                </div>
                <div class="text-xs text-[var(--of-text-secondary)]">{plugin.manifest.description}</div>
                <div class="text-xs text-[var(--of-text-muted)] font-mono break-all">{pluginSourceLabel(plugin)}</div>

                {#if plugin.packageMetadata?.requires?.length}
                  <div class="flex items-center gap-2 mt-1 flex-wrap">
                    <span class="text-xs text-[var(--of-text-muted)]">Capabilities:</span>
                    {#each plugin.packageMetadata.requires as capability}
                      <Badge>{capability}</Badge>
                    {/each}
                  </div>
                {/if}
                {#if plugin.manifest.permissions?.length}
                  <div class="flex items-center gap-2 mt-1 flex-wrap">
                    <span class="text-xs text-[var(--of-text-muted)]">Permissions:</span>
                    {#each plugin.manifest.permissions as permission}
                      <Badge>{permission}</Badge>
                    {/each}
                  </div>
                {/if}
                {#if themes.length > 0}
                  <div class="flex flex-col gap-1 mt-1">
                    <span class="text-xs text-[var(--of-text-muted)]">Themes:</span>
                    <ul class="m-0 list-none p-0 flex flex-wrap gap-1" aria-label="Themes provided by {plugin.manifest.name}">
                      {#each themes as theme (theme.id)}
                        <li><Badge>{theme.label}</Badge></li>
                      {/each}
                    </ul>
                    <span class="text-xs text-[var(--of-text-muted)]">Provided by {plugin.manifest.id}</span>
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
              <Panel padding="none" variant="subtle">
                <div role="alert" class="text-xs text-[var(--of-danger)] p-2 flex items-start gap-2">
                  <AlertCircle size={14} class="shrink-0 mt-0.5" />
                  <span class="break-words">{plugin.error}</span>
                </div>
              </Panel>
            {/if}

            <GlobalPluginSettingsSections pluginId={plugin.manifest.id} {activeProjectId} />
          </div>
        </Panel>
      {/each}
    </div>
  {/if}
</div>
