<script lang="ts">
  import ProviderSelectField from './ProviderSelectField.svelte'
  import type { SettingsViewController } from './settingsViewController.svelte'

  interface Props {
    controller: SettingsViewController
    providerValue: string
    scope: 'global' | 'project'
  }

  let { controller, providerValue, scope }: Props = $props()
</script>

<ProviderSelectField
  aiProvider={providerValue}
  opencodeInstalled={controller.opencodeInstalled}
  opencodeVersion={controller.opencodeVersion}
  claudeInstalled={controller.claudeInstalled}
  claudeVersion={controller.claudeVersion}
  claudeAuthenticated={controller.claudeAuthenticated}
  piInstalled={controller.piInstalled}
  piVersion={controller.piVersion}
  codexInstalled={controller.codexInstalled}
  codexVersion={controller.codexVersion}
  grokInstalled={controller.grokInstalled}
  grokVersion={controller.grokVersion}
  grokAuthenticated={controller.grokAuthenticated}
  installationStatusLoading={controller.installationStatusLoading}
  installationStatusError={controller.installationStatusError}
  disabled={scope === 'project' ? !controller.hasProject : !controller.globalSettingsLoaded}
  onChange={(value) => scope === 'project'
    ? controller.handleProjectSettingChange('ai_provider', value)
    : controller.handleGlobalSettingChange('ai_provider', value)}
  onRefreshInstallationStatus={controller.refreshInstallationStatus}
/>
