<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import { writeClipboardText } from '../../lib/ipc'
  import { appEnabledPluginIds, enabledPluginIds, error as pluginLoadError } from '../../lib/plugin/pluginStore'
  import type { PluginEntry } from '../../lib/plugin/types'
  import { viewReplacementFailures } from '../../lib/plugin/viewReplacementDiagnostics'
  import { pluginActionErrorMessage } from './globalPluginSettings'

  interface Props {
    plugin: PluginEntry
    activeProjectId?: string | null
    disabled?: boolean
    onActionError?: (error: string | null) => void
  }

  let { plugin, activeProjectId = null, disabled = false, onActionError }: Props = $props()

  function diagnosticsFor(): string {
    return JSON.stringify({
      pluginId: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      apiVersion: plugin.manifest.apiVersion,
      state: plugin.state,
      enablement: plugin.packageMetadata?.enablement ?? 'project',
      enabledForApp: $appEnabledPluginIds.has(plugin.manifest.id),
      enabledForActiveProject: $enabledPluginIds.has(plugin.manifest.id),
      activeProjectId,
      sourceKind: plugin.sourceKind ?? (plugin.isBuiltin ? 'builtin' : 'unknown'),
      sourceSpec: plugin.sourceSpec ?? null,
      installPath: plugin.installPath ?? null,
      frontend: plugin.manifest.frontend,
      backend: plugin.manifest.backend,
      error: plugin.error,
      loadError: $pluginLoadError,
      replacementFailures: [...$viewReplacementFailures.values()].filter(failure => failure.pluginId === plugin.manifest.id),
    }, null, 2)
  }

  async function copyDiagnostics() {
    if (disabled) return

    onActionError?.(null)
    try {
      await writeClipboardText(diagnosticsFor())
    } catch (error) {
      onActionError?.(`Failed to copy diagnostics: ${pluginActionErrorMessage(error)}`)
    }
  }
</script>

<Button variant="ghost" size="xs" type="button" aria-label="Copy diagnostics: {plugin.manifest.name}" {disabled} onclick={copyDiagnostics}>Copy diagnostics</Button>
