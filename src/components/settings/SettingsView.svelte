<script lang="ts">
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import {
    AudioLines,
    Blocks,
    Bot,
    Code2,
    Filter,
    FolderOpen,
    GitBranch,
    RotateCcw,
    Settings2,
    Smartphone,
    Sparkles,
    Tags,
    TriangleAlert,
  } from '@lucide/svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import GlobalSettingsContent from './GlobalSettingsContent.svelte'
  import ProjectSettingsContent from './ProjectSettingsContent.svelte'
  import SettingsCategoryNav from './SettingsCategoryNav.svelte'
  import type { SettingsCategory } from './SettingsCategoryNav.svelte'
  import { useSettingsViewController } from './settingsViewController.svelte'
  import type { SettingsViewMode } from './settingsViewController.svelte'

  interface Props {
    onClose: () => void
    onProjectDeleted: () => void
    onProjectSettingsSaved?: () => void | Promise<void>
    mode: SettingsViewMode
  }

  let { onClose, onProjectDeleted, onProjectSettingsSaved, mode }: Props = $props()

  const projectCategories: SettingsCategory[] = [
    { id: 'general', label: 'General', description: 'Project identity and inherited defaults', icon: FolderOpen },
    { id: 'agents', label: 'Agents & tasks', description: 'Provider and task behavior', icon: Bot },
    { id: 'labels', label: 'Labels', description: 'Task label management', icon: Tags },
    { id: 'focus', label: 'Focus filter', description: 'Attention and board filters', icon: Filter },
    { id: 'instructions', label: 'AI instructions', description: 'Project-specific agent instructions', icon: Sparkles },
    { id: 'plugins', label: 'Plugins', description: 'Project Plugin Enablement', icon: Blocks },
    { id: 'danger', label: 'Danger Zone', description: 'Destructive project actions', icon: TriangleAlert, danger: true },
  ]

  const globalCategories: SettingsCategory[] = [
    { id: 'general', label: 'General', description: 'App-wide defaults and appearance', icon: Settings2 },
    { id: 'agents', label: 'Agents', description: 'Provider defaults and connection health', icon: Bot },
    { id: 'github', label: 'GitHub & Credentials', description: 'Credentials and GitHub polling', icon: GitBranch },
    { id: 'voice', label: 'Voice & Whisper', description: 'Speech model management', icon: AudioLines },
    { id: 'plugins', label: 'Plugins', description: 'Plugin Installation and global defaults', icon: Blocks },
    { id: 'companion', label: 'Companion', description: 'Companion gateway and paired devices', icon: Smartphone },
    { id: 'developer', label: 'Developer logs', description: 'Diagnostics and application logs', icon: Code2 },
  ]

  const controller = useSettingsViewController({
    getMode: () => mode,
    onProjectDeleted: () => {
      onProjectDeleted()
      onClose()
    },
    onProjectSettingsSaved: () => onProjectSettingsSaved?.(),
  })
  let activeSection = $state('general')
  const settingsCategories = $derived(controller.mode === 'global' ? globalCategories : projectCategories)

  $effect(() => {
    if (!settingsCategories.some((category) => category.id === activeSection)) {
      activeSection = 'general'
    }
  })
</script>

<div class="flex h-full w-full flex-col overflow-hidden bg-[var(--of-surface-subtle)] lg:flex-row">
  <SettingsCategoryNav
    categories={settingsCategories}
    activeId={activeSection}
    onSelect={(id) => { activeSection = id }}
  />

  <main class="settings-layout min-w-0 flex-1 overflow-y-auto bg-[var(--of-surface-subtle)]" aria-label={controller.activePage === 'project' ? 'Project settings' : 'Global settings'}>
    <Panel padding="none">
      <header class="flex shrink-0 flex-col gap-3 px-4 py-4 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 class="m-0 text-xl font-semibold tracking-tight sm:text-[1.4rem]">
            {controller.activePage === 'project' ? `${controller.projectName || 'Project'} / Project Settings` : 'Global Settings'}
          </h1>
          <p class="m-0 mt-1 text-sm leading-5 text-[var(--of-text-muted)]">
            {controller.activePage === 'project'
              ? 'Configure settings for this project only. Inherited defaults remain visible.'
              : 'Configure app-wide defaults, integrations, and credentials.'}
          </p>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <div class="settings-layout min-w-32 text-right text-xs" aria-live="polite">
            {#if controller.projectSettingsLoadError || controller.globalSettingsLoadError}
              <span class="font-medium text-[var(--of-danger)]">Failed to load settings: {controller.projectSettingsLoadError ?? controller.globalSettingsLoadError}</span>
            {:else if controller.settingsLoading}
              <span class="inline-flex items-center gap-2 text-[var(--of-text-muted)]"><span class="loading loading-spinner loading-xs" aria-hidden="true"></span>Loading settings…</span>
            {:else if controller.saveStatus === 'dirty'}
              <span class="font-medium text-[var(--of-warning)]">Unsaved changes — autosaving soon…</span>
            {:else if controller.isSaving || controller.saveStatus === 'saving'}
              <span class="inline-flex items-center gap-2 text-[var(--of-text-muted)]"><span class="loading loading-spinner loading-xs" aria-hidden="true"></span>Saving changes…</span>
            {:else if controller.saved || controller.saveStatus === 'saved'}
              <span class="font-medium text-[var(--of-success)]">All changes saved</span>
            {:else if controller.saveStatus === 'error'}
              <span class="inline-flex items-center gap-2 text-[var(--of-danger)]">
                Autosave failed: {controller.saveError}
                <Button type="button" variant="danger" size="xs" onclick={controller.runImmediateSave}>Retry autosave</Button>
              </span>
            {:else}
              <span class="text-[var(--of-text-muted)]">Autosaves changes</span>
            {/if}
          </div>

          {#if controller.activePage === 'project'}
            <Badge variant="warning">
              {controller.projectOverrideCount} {controller.projectOverrideCount === 1 ? 'override' : 'overrides'}
            </Badge>
            <Button
              type="button"
              variant="outline" size="sm"
              onclick={controller.handleResetToGlobal}
              disabled={!controller.hasProject || controller.projectOverrideCount === 0}
            >
              <RotateCcw size={15} aria-hidden="true" />
              Reset all
            </Button>
          {/if}

          <Button type="button" variant="ghost" size="sm" onclick={onClose}>Back to Board</Button>
        </div>
      </header>
    </Panel>

    <div class="settings-layout mx-auto flex w-full max-w-[76rem] flex-col gap-5 p-4 sm:p-6 xl:p-8">
      {#if controller.activePage === 'project'}
        <ProjectSettingsContent {activeSection} {controller} />
      {:else}
        <GlobalSettingsContent {activeSection} {controller} />
      {/if}
    </div>
  </main>
</div>
