<script lang="ts">
  import { AlertCircle } from '@lucide/svelte'
  import PluginFolderConfiguration from './PluginFolderConfiguration.svelte'

  interface Props {
    activeProjectId?: string | null
    disabled?: boolean
  }

  let { activeProjectId = null, disabled = false }: Props = $props()

  let actionError = $state<string | null>(null)
</script>

<div class="flex flex-col gap-3 p-4 border border-base-300 rounded-lg bg-base-200/30">
  <div class="flex flex-col gap-1">
    <span class="text-[0.7rem] text-base-content/50 uppercase tracking-wider">Plugin folder</span>
    <p class="text-xs text-base-content/60 m-0">
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
    <div class="text-xs text-error bg-error/10 p-2 rounded flex items-start gap-2">
      <AlertCircle size={14} class="shrink-0 mt-0.5" />
      <!-- A refresh can fail for more than one package, so each failure keeps its own line. -->
      <span class="break-words whitespace-pre-line">{actionError}</span>
    </div>
  {/if}
</div>
