<script lang="ts">
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import { AlertCircle, Blocks } from '@lucide/svelte'
  import { error as pluginLoadError } from '../../lib/plugin/pluginStore'
  import SettingsSectionCard from '../settings/SettingsSectionCard.svelte'
  import GlobalPluginInstallationSection from './GlobalPluginInstallationSection.svelte'
  import GlobalPluginInventory from './GlobalPluginInventory.svelte'

  interface Props {
    activeProjectId?: string | null
    disabled?: boolean
    // Global enable-by-default state keyed by plugin id (explicit global default
    // if set, else builtin default). This is the GLOBAL layer, not per-project enablement.
    pluginDefaults?: Map<string, boolean>
    onToggleDefault?: (pluginId: string, enabled: boolean) => void
  }

  let {
    activeProjectId = null,
    disabled = false,
    pluginDefaults = new Map(),
    onToggleDefault,
  }: Props = $props()

  let actionError = $state<string | null>(null)

  function handleActionError(error: string | null) {
    actionError = error
  }
</script>

<SettingsSectionCard id="section-plugins" title="Plugins" {disabled}>
  {#snippet icon()}<Blocks size={16} />{/snippet}
  <div class="flex flex-col gap-6">
    <GlobalPluginInstallationSection {activeProjectId} {disabled} onActionError={handleActionError} />

    {#if $pluginLoadError}
      <Panel padding="none" variant="subtle">
        <div class="text-xs text-[var(--of-danger)] p-3 flex items-start gap-2">
        <AlertCircle size={14} class="shrink-0 mt-0.5" />
        <span class="break-words">{$pluginLoadError}</span>
      </div>
      </Panel>
    {/if}

    {#if actionError}
      <Panel padding="none" variant="subtle">
        <div class="text-xs text-[var(--of-danger)] p-3 flex items-start gap-2">
        <AlertCircle size={14} class="shrink-0 mt-0.5" />
        <span class="break-words">{actionError}</span>
      </div>
      </Panel>
    {/if}

    <GlobalPluginInventory
      {activeProjectId}
      {disabled}
      {pluginDefaults}
      {onToggleDefault}
      onActionError={handleActionError}
    />
  </div>
</SettingsSectionCard>
