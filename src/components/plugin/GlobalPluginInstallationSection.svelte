<script lang="ts">
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import Select from '@openforge-app/plugin-sdk/ui/Select.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import {
    enablePluginForApp,
    enablePluginForProject,
    installFromLocal,
    installPluginFromGit,
    installPluginFromNpm,
  } from '../../lib/plugin/pluginRegistry'
  import { appEnabledPluginIds, enabledPluginIds, installedPlugins } from '../../lib/plugin/pluginStore'
  import { pluginActionErrorMessage } from './globalPluginSettings'
  import PluginFolderPanel from './PluginFolderPanel.svelte'

  interface Props {
    activeProjectId?: string | null
    disabled?: boolean
    onActionError?: (error: string | null) => void
  }

  type SourceType = 'npm' | 'git' | 'local'

  let { activeProjectId = null, disabled = false, onActionError }: Props = $props()

  let sourceType = $state<SourceType>('npm')
  let sourceInput = $state('')
  let installError = $state<string | null>(null)
  let installMessage = $state<string | null>(null)
  let installedPluginToEnableId = $state<string | null>(null)
  let isInstalling = $state(false)

  let installedPluginToEnable = $derived(installedPluginToEnableId ? $installedPlugins.get(installedPluginToEnableId) : null)
  let installedPluginUsesAppEnablement = $derived(installedPluginToEnable?.packageMetadata?.enablement === 'app')
  let canEnableInstalledPluginForApp = $derived(installedPluginUsesAppEnablement && !!installedPluginToEnableId && !$appEnabledPluginIds.has(installedPluginToEnableId))
  let canEnableInstalledPluginForActiveProject = $derived(!installedPluginUsesAppEnablement && !!activeProjectId && !!installedPluginToEnableId && !$enabledPluginIds.has(installedPluginToEnableId))
  let sourcePlaceholder = $derived(sourceType === 'npm'
    ? '@acme/openforge-github@1.2.0'
    : sourceType === 'git'
      ? 'github.com/acme/openforge-tools@main'
      : '/path/to/local/plugin')

  function sourceWithoutPrefix(source: string, prefix: string): string {
    return source.startsWith(prefix) ? source.slice(prefix.length) : source
  }

  async function handleInstall(event: SubmitEvent) {
    event.preventDefault()
    if (disabled) return

    const source = sourceInput.trim()
    installError = null
    installMessage = null
    installedPluginToEnableId = null
    onActionError?.(null)

    if (!source) {
      installError = 'Enter a plugin package source to install.'
      return
    }

    const beforePluginIds = new Set($installedPlugins.keys())
    isInstalling = true
    try {
      if (sourceType === 'npm') {
        await installPluginFromNpm(sourceWithoutPrefix(source, 'npm:'))
      } else if (sourceType === 'git') {
        await installPluginFromGit(sourceWithoutPrefix(source, 'git:'))
      } else {
        await installFromLocal(sourceWithoutPrefix(source, 'local:'), activeProjectId ?? '')
      }

      installedPluginToEnableId = Array.from($installedPlugins.keys()).find((pluginId) => !beforePluginIds.has(pluginId)) ?? null
      installMessage = installedPluginToEnable?.packageMetadata?.enablement === 'app'
        ? 'Installed. Enable it once to use it throughout OpenForge.'
        : 'Installed app-wide. Enable it explicitly in each project when ready.'
      sourceInput = ''
    } catch (error) {
      installError = pluginActionErrorMessage(error)
    } finally {
      isInstalling = false
    }
  }

  async function handleEnableForApp() {
    if (disabled || !installedPluginToEnableId) return

    onActionError?.(null)
    try {
      await enablePluginForApp(installedPluginToEnableId)
      installMessage = 'Installed and enabled throughout OpenForge.'
    } catch (error) {
      onActionError?.(pluginActionErrorMessage(error))
    }
  }

  async function handleEnableForActiveProject() {
    if (disabled || !activeProjectId || !installedPluginToEnableId) return

    onActionError?.(null)
    try {
      await enablePluginForProject(activeProjectId, installedPluginToEnableId)
      installMessage = 'Installed app-wide and enabled for the active project.'
    } catch (error) {
      onActionError?.(pluginActionErrorMessage(error))
    }
  }
</script>

<PluginFolderPanel {activeProjectId} {disabled} />

<Panel variant="subtle">
  <form class="flex flex-col gap-3" onsubmit={handleInstall}>
    <div class="flex flex-col gap-1">
      <span class="text-xs text-[var(--of-text-muted)] uppercase tracking-wider">Install package</span>
      <p class="text-xs text-[var(--of-text-secondary)] m-0">Install packages here. App-owned plugins are enabled once; project-owned plugins are enabled per Project.</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-[10rem_1fr_auto] gap-3 items-start">
      <Select
        label="Source type"
        options={[{ value: 'npm', label: 'npm' }, { value: 'git', label: 'git' }, { value: 'local', label: 'local path' }]}
        value={sourceType}
        onValueChange={(value) => sourceType = value as SourceType}
        disabled={disabled || isInstalling}
      />
      <TextField
        label="Package source"
        bind:value={sourceInput}
        placeholder={sourcePlaceholder}
        error={installError}
        disabled={disabled || isInstalling}
      />
      <Button variant="primary" size="sm" class="self-end" type="submit" disabled={disabled || isInstalling}>
        {isInstalling ? 'Installing…' : 'Install package'}
      </Button>
    </div>

    {#if installMessage}
      <Panel padding="none" variant="subtle">
        <div role="status" class="text-xs text-[var(--of-success)] p-2 flex flex-col gap-2">
          <span>{installMessage}</span>
          {#if canEnableInstalledPluginForApp && installedPluginToEnable}
            <Button class="self-start" size="xs" type="button" onclick={handleEnableForApp} disabled={disabled}>
              Enable throughout OpenForge: {installedPluginToEnable.manifest.name}
            </Button>
          {/if}
          {#if canEnableInstalledPluginForActiveProject && installedPluginToEnable}
            <Button class="self-start" size="xs" type="button" onclick={handleEnableForActiveProject} disabled={disabled}>
              Enable for active project: {installedPluginToEnable.manifest.name}
            </Button>
          {/if}
        </div>
      </Panel>
    {/if}
  </form>
</Panel>
