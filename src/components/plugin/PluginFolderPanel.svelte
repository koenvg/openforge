<script lang="ts">
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import { AlertCircle } from '@lucide/svelte'
  import PluginFolderConfiguration from './PluginFolderConfiguration.svelte'

  interface Props {
    activeProjectId?: string | null
    disabled?: boolean
  }

  let { activeProjectId = null, disabled = false }: Props = $props()

  let actionError = $state<string | null>(null)
</script>

<Panel variant="subtle">
  <div class="flex flex-col gap-3">
    <div class="flex flex-col gap-1">
      <span class="text-xs text-[var(--of-text-muted)] uppercase tracking-wider">Plugin folder</span>
      <p class="text-xs text-[var(--of-text-secondary)] m-0">
        Point OpenForge at a folder of plugin packages to install any of them in one click. Refresh picks up
        new packages and reloads the ones already installed from here, so a rebuild reaches every project.
      </p>
    </div>

    <PluginFolderConfiguration
      {activeProjectId}
      {disabled}
      onActionError={(error) => actionError = error}
    />

    {#if actionError}
      <Panel padding="none" variant="subtle">
        <div role="alert" class="text-xs text-[var(--of-danger)] p-2 flex items-start gap-2">
          <AlertCircle size={14} class="shrink-0 mt-0.5" />
          <!-- A refresh can fail for more than one package, so each failure keeps its own line. -->
          <span class="break-words whitespace-pre-line">{actionError}</span>
        </div>
      </Panel>
    {/if}
  </div>
</Panel>
