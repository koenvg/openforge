<script lang="ts">
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
  import ProjectPageHeader from '../project/ProjectPageHeader.svelte'
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

<div class="flex h-full w-full flex-col overflow-hidden bg-base-200 lg:flex-row">
  <SettingsCategoryNav
    categories={settingsCategories}
    activeId={activeSection}
    onSelect={(id) => { activeSection = id }}
  />

  <main class="min-w-0 flex-1 overflow-y-auto bg-base-200" aria-label={controller.activePage === 'project' ? 'Project settings' : 'Global settings'}>
    <ProjectPageHeader
      title={controller.activePage === 'project'
        ? `${controller.projectName || 'Project'} / Project Settings`
        : 'Global Settings'}
      subtitle={controller.activePage === 'project'
        ? 'Configure settings for this project only. Inherited defaults remain visible.'
        : 'Configure app-wide defaults, integrations, and credentials.'}
    >
      {#snippet actions()}
        <div class="flex flex-wrap items-center justify-end gap-2">
          <div class="min-w-32 text-right text-xs" aria-live="polite">
            {#if controller.projectSettingsLoadError || controller.globalSettingsLoadError}
              <span class="font-medium text-error">Failed to load settings: {controller.projectSettingsLoadError ?? controller.globalSettingsLoadError}</span>
            {:else if controller.settingsLoading}
              <span class="inline-flex items-center gap-2 text-base-content/60"><span class="loading loading-spinner loading-xs" aria-hidden="true"></span>Loading settings…</span>
            {:else if controller.saveStatus === 'dirty'}
              <span class="font-medium text-warning">Unsaved changes — autosaving soon…</span>
            {:else if controller.isSaving || controller.saveStatus === 'saving'}
              <span class="inline-flex items-center gap-2 text-base-content/60"><span class="loading loading-spinner loading-xs" aria-hidden="true"></span>Saving changes…</span>
            {:else if controller.saved || controller.saveStatus === 'saved'}
              <span class="font-medium text-success">All changes saved</span>
            {:else if controller.saveStatus === 'error'}
              <span class="inline-flex items-center gap-2 text-error">
                Autosave failed: {controller.saveError}
                <button type="button" class="btn btn-xs btn-error" onclick={controller.runImmediateSave}>Retry autosave</button>
              </span>
            {:else}
              <span class="text-base-content/55">Autosaves changes</span>
            {/if}
          </div>

          {#if controller.activePage === 'project'}
            <span class="badge min-h-8 border-warning/35 bg-warning/10 px-3 text-warning">
              {controller.projectOverrideCount} {controller.projectOverrideCount === 1 ? 'override' : 'overrides'}
            </span>
            <button
              type="button"
              class="btn btn-outline btn-sm min-h-10"
              onclick={controller.handleResetToGlobal}
              disabled={!controller.hasProject || controller.projectOverrideCount === 0}
            >
              <RotateCcw size={15} aria-hidden="true" />
              Reset all
            </button>
          {/if}

          <button type="button" class="btn btn-ghost btn-sm min-h-10" onclick={onClose}>Back to Board</button>
        </div>
      {/snippet}
    </ProjectPageHeader>

    <div class="mx-auto flex w-full max-w-[76rem] flex-col gap-5 p-4 sm:p-6 xl:p-8">
      {#if controller.activePage === 'project'}
        <ProjectSettingsContent {activeSection} {controller} />
      {:else}
        <GlobalSettingsContent {activeSection} {controller} />
      {/if}
    </div>
  </main>
</div>
