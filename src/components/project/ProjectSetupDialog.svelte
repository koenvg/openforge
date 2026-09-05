<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  import Switch from '@openforge-app/plugin-sdk/ui/Switch.svelte'
  import { onMount, tick } from 'svelte'
  import type { Project } from '../../lib/types'
  import { createProject, createProjectFromGit, createProjectFromNewRepo, selectDirectory, getConfig, setConfig } from '../../lib/ipc'
  import { deriveProjectNameFromPath } from '../../lib/deriveProjectName'
  import { deriveRepoNameFromUrl } from '../../lib/deriveRepoNameFromUrl'
  import { computeTargetPathPreview, canSubmitGithub, canSubmitNewRepo } from './projectSetupDialogLogic'
  import { Sparkles, GitBranch, FolderOpen } from '@lucide/svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'

  interface Props {
    onClose?: () => void
    onProjectCreated?: (project: Project) => void | Promise<void>
  }

  let { onClose, onProjectCreated }: Props = $props()

  let projectName = $state('')
  let path = $state('')
  let nameManuallyEdited = $state(false)
  let isSubmitting = $state(false)
  let createError = $state<string | null>(null)
  let successMessage = $state<string | null>(null)

  const creationFeedbackId = 'add-project-creation-feedback'

  const DEFAULT_REPOS_DIR_KEY = 'default_repositories_dir'

  let mode = $state<'newRepo' | 'github' | 'local'>('local')
  let repoUrl = $state('')
  let parentDir = $state('')
  let repoPrivate = $state(true)

  let githubTargetPreview = $derived(computeTargetPathPreview(parentDir, deriveRepoNameFromUrl(repoUrl)))
  let newRepoTargetPreview = $derived(computeTargetPathPreview(parentDir, projectName))

  let canSubmitLocal = $derived(!isSubmitting && path.trim().length > 0 && projectName.trim().length > 0)
  let canSubmitGithubMode = $derived(canSubmitGithub({ repoUrl, parentDir, projectName, isSubmitting }))
  let canSubmitNewRepoMode = $derived(canSubmitNewRepo({ name: projectName, parentDir, isSubmitting }))
  let canSubmit = $derived(
    mode === 'local' ? canSubmitLocal : mode === 'github' ? canSubmitGithubMode : canSubmitNewRepoMode
  )

  onMount(async () => {
    try {
      const remembered = await getConfig(DEFAULT_REPOS_DIR_KEY)
      if (remembered && !parentDir) parentDir = remembered
    } catch (e) {
      console.error('Failed to load default repositories directory:', e)
    }
  })

  function getFailureMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message
    return String(error || 'Failed to create project')
  }

  async function handleSelectRepository() {
    createError = null
    try {
      const selectedPath = await selectDirectory({
        defaultPath: path.trim() || undefined,
        buttonLabel: 'Use Repository',
        message: 'Select the local git repository for this project.',
      })
      if (!selectedPath) return
      path = selectedPath
      // Auto-fill from the repo folder name, but never clobber a non-empty name
      // the user typed. If the field is empty we always (re)derive so the user is
      // never left stuck with a blank, required name.
      if (!nameManuallyEdited || !projectName.trim()) {
        projectName = deriveProjectNameFromPath(selectedPath)
      }
      await tick()
      document.querySelector<HTMLInputElement>('[data-project-name-input]')?.focus()
    } catch (e) {
      createError = getFailureMessage(e)
      console.error('Failed to select repository directory:', e)
    }
  }

  function handleNameInput() {
    nameManuallyEdited = true
    if (createError) createError = null
  }

  function handleRepoUrlInput() {
    if (createError) createError = null
    if (!nameManuallyEdited || !projectName.trim()) {
      const derived = deriveRepoNameFromUrl(repoUrl)
      if (derived) projectName = derived
    }
  }

  async function handleSelectParentFolder() {
    createError = null
    try {
      const selected = await selectDirectory({
        defaultPath: parentDir.trim() || undefined,
        buttonLabel: 'Choose Parent Folder',
        message: 'Choose the folder OpenForge should clone the repository into.',
      })
      if (!selected) return
      parentDir = selected
    } catch (e) {
      createError = getFailureMessage(e)
      console.error('Failed to select parent folder:', e)
    }
  }

  async function handleSubmit() {
    createError = null
    successMessage = null

    isSubmitting = true
    try {
      let project: Project
      if (mode === 'local') {
        if (!path.trim() || !projectName.trim()) return
        project = await createProject(projectName.trim(), path.trim())
      } else if (mode === 'github') {
        if (!repoUrl.trim() || !parentDir.trim() || !projectName.trim()) return
        project = await createProjectFromGit({
          url: repoUrl.trim(),
          parentDir: parentDir.trim(),
          name: projectName.trim(),
        })
      } else {
        if (!projectName.trim() || !parentDir.trim()) return
        project = await createProjectFromNewRepo({
          name: projectName.trim(),
          parentDir: parentDir.trim(),
          private: repoPrivate,
        })
      }
      // Remember where repos live for next time (clone + new-repo modes).
      if (mode !== 'local' && parentDir.trim()) {
        void setConfig(DEFAULT_REPOS_DIR_KEY, parentDir.trim())
      }
      successMessage = `Project created. Opening ${project.name}.`
      await tick()
      await new Promise((resolve) => window.setTimeout(resolve, 300))
      await onProjectCreated?.(project)
    } catch (e) {
      createError = getFailureMessage(e)
      console.error('Failed to create project:', e)
    } finally {
      isSubmitting = false
    }
  }

  function close() {
    onClose?.()
  }
</script>

<Modal ariaLabel="Add Project" closeLabel="Close Add Project" closeDisabled={isSubmitting} onClose={close} maxWidth="550px" initialFocus="[data-select-repository]">
  {#snippet header()}
    <h2 class="text-[0.95rem] font-semibold text-base-content m-0">Add Project</h2>
  {/snippet}

  <form id="add-project-form" class="flex-1 overflow-y-auto p-5 flex flex-col gap-4" onsubmit={(e: SubmitEvent) => { e.preventDefault(); void handleSubmit() }}>
    <div role="radiogroup" aria-label="How to add the project" class="grid grid-cols-3 gap-2">
      {#each [
        { id: 'newRepo', icon: Sparkles, title: 'New repo', desc: 'Create it on GitHub & clone it' },
        { id: 'github', icon: GitBranch, title: 'From GitHub', desc: 'Clone an existing repo by URL' },
        { id: 'local', icon: FolderOpen, title: 'Local folder', desc: 'Use a repo already on your disk' },
      ] as option (option.id)}
        {@const Icon = option.icon}
        <button
          type="button"
          role="radio"
          aria-checked={mode === option.id}
          class="flex flex-col items-start gap-1 rounded-[var(--of-radius-container)] border border-base-300 p-3 text-left transition hover:bg-base-200 {mode === option.id ? 'ring-2 ring-primary' : ''}"
          onclick={() => { mode = option.id as typeof mode; createError = null }}
          disabled={isSubmitting}
        >
          <Icon class="size-4 text-base-content/70" />
          <span class="text-xs font-semibold text-base-content">{option.title}</span>
          <span class="text-[0.65rem] text-base-content/50 leading-tight">{option.desc}</span>
        </button>
      {/each}
    </div>

    <p class="text-sm text-base-content/70 m-0">
      {#if mode === 'newRepo'}
        Name a new project and OpenForge will create the repository on GitHub, clone it, and open it. You make the first commit.
      {:else if mode === 'github'}
        Paste a GitHub repository URL and OpenForge will clone it and set up the project.
      {:else}
        Connect a local repository so OpenForge can track tasks and agent progress for it.
      {/if}
    </p>

    {#if createError}
      <div id={creationFeedbackId} class="alert alert-error py-2 text-sm" role="alert">
        <span>{createError}</span>
      </div>
    {:else if successMessage}
      <div id={creationFeedbackId} class="alert alert-success py-2 text-sm" role="status">
        <span>{successMessage}</span>
      </div>
    {/if}

    {#if mode === 'local'}
      {#if !path}
        <div class="flex flex-col gap-1.5">
          <Button
            data-select-repository
            variant="primary" size="sm" class="w-full"
            type="button"
            onclick={handleSelectRepository}
            disabled={isSubmitting}
          >
            Select Repository
          </Button>
          <span class="text-[0.65rem] text-base-content/40">Pick the local git repository for this project. Using the picker lets OpenForge access folders in macOS Documents/Desktop.</span>
        </div>
      {:else}
        <div class="flex flex-col gap-1.5">
          <span id="add-project-repository-label" class="text-xs text-base-content/60 font-medium">Repository</span>
          <div class="flex items-center gap-2">
            <span class="w-full flex items-center font-mono text-xs truncate border border-[var(--of-border-interactive)] rounded-[var(--of-radius-control)] min-h-[var(--of-control-height-compact)] px-2" role="group" aria-labelledby="add-project-repository-label" title={path}>{path}</span>
            <Button
              data-select-repository
              variant="ghost" size="sm"
              type="button"
              onclick={handleSelectRepository}
              disabled={isSubmitting}
            >
              Change
            </Button>
          </div>
        </div>

        <label class="flex flex-col gap-1.5">
          <span class="text-xs text-base-content/60 font-medium">Project Name <span class="text-error" aria-hidden="true">*</span></span>
          <TextField label="Project Name" hideLabel size="sm"
            data-project-name-input
            type="text"
            bind:value={projectName}
            placeholder="My Awesome Project"
            oninput={handleNameInput}
            autocomplete="off"
            aria-describedby={createError || successMessage ? creationFeedbackId : undefined}
          />
        </label>
      {/if}
    {:else if mode === 'github'}
      <label class="flex flex-col gap-1.5">
        <span class="text-xs text-base-content/60 font-medium">Repository URL <span class="text-error" aria-hidden="true">*</span></span>
        <TextField label="Repository URL" hideLabel size="sm"
          type="text"
          bind:value={repoUrl}
          oninput={handleRepoUrlInput}
          placeholder="https://github.com/owner/repo"
          autocomplete="off"
        />
        <span class="text-[0.65rem] text-base-content/40">Paste an HTTPS or SSH URL, or owner/repo. Private repos use your saved GitHub token.</span>
      </label>

      <div class="flex flex-col gap-1.5">
        <span id="add-project-parent-label" class="text-xs text-base-content/60 font-medium">Parent Folder <span class="text-error" aria-hidden="true">*</span></span>
        <div class="flex items-center gap-2">
          <span class="w-full flex items-center font-mono text-xs truncate border border-[var(--of-border-interactive)] rounded-[var(--of-radius-control)] min-h-[var(--of-control-height-compact)] px-2" role="group" aria-labelledby="add-project-parent-label" title={parentDir}>{parentDir || 'No folder selected'}</span>
          <Button variant="ghost" size="sm" type="button" onclick={handleSelectParentFolder} disabled={isSubmitting}>Choose</Button>
        </div>
      </div>

      <label class="flex flex-col gap-1.5">
        <span class="text-xs text-base-content/60 font-medium">Project Name <span class="text-error" aria-hidden="true">*</span></span>
        <TextField label="Project Name" hideLabel size="sm"
          data-project-name-input
          type="text"
          bind:value={projectName}
          placeholder="My Awesome Project"
          oninput={handleNameInput}
          autocomplete="off"
          aria-describedby={createError || successMessage ? creationFeedbackId : undefined}
        />
      </label>

      {#if githubTargetPreview}
        <p class="text-[0.65rem] text-base-content/40 m-0">Will clone into <span class="font-mono">{githubTargetPreview}</span></p>
      {/if}
    {:else}
      <label class="flex flex-col gap-1.5">
        <span class="text-xs text-base-content/60 font-medium">Project Name <span class="text-error" aria-hidden="true">*</span></span>
        <TextField label="Project Name" hideLabel size="sm"
          data-project-name-input
          type="text"
          bind:value={projectName}
          placeholder="my-idea"
          oninput={handleNameInput}
          autocomplete="off"
          aria-describedby={createError || successMessage ? creationFeedbackId : undefined}
        />
        <span class="text-[0.65rem] text-base-content/40">GitHub normalizes spaces to hyphens; the folder uses the created repo's name.</span>
      </label>

      <div class="flex flex-col gap-1.5">
        <span id="add-project-newrepo-parent-label" class="text-xs text-base-content/60 font-medium">Repositories Folder <span class="text-error" aria-hidden="true">*</span></span>
        <div class="flex items-center gap-2">
          <span class="w-full flex items-center font-mono text-xs truncate border border-[var(--of-border-interactive)] rounded-[var(--of-radius-control)] min-h-[var(--of-control-height-compact)] px-2" role="group" aria-labelledby="add-project-newrepo-parent-label" title={parentDir}>{parentDir || 'No folder selected'}</span>
          <Button variant="ghost" size="sm" type="button" onclick={handleSelectParentFolder} disabled={isSubmitting}>Choose</Button>
        </div>
      </div>

      <Switch label="Private repository" bind:checked={repoPrivate} disabled={isSubmitting} />

      {#if newRepoTargetPreview}
        <p class="text-[0.65rem] text-base-content/40 m-0">Will create at <span class="font-mono">{newRepoTargetPreview}</span></p>
      {/if}
    {/if}
  </form>

  <div class="flex gap-2.5 px-5 py-4 border-t border-base-300 justify-end">
    <Button variant="ghost" size="sm" onclick={close} type="button" disabled={isSubmitting}>Cancel</Button>
    <Button
      variant="primary" size="sm"
      form="add-project-form"
      type="submit"
      disabled={!canSubmit}
      aria-describedby={createError || successMessage ? creationFeedbackId : undefined}
    >
      {isSubmitting ? (mode === 'newRepo' ? 'Creating repo...' : mode === 'github' ? 'Cloning...' : 'Creating...') : 'Create Project'}
    </Button>
  </div>
</Modal>
