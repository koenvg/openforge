<script lang="ts">
  import { tick } from 'svelte'
  import type { Project } from '../../lib/types'
  import { createProject, createProjectFromGit, selectDirectory } from '../../lib/ipc'
  import { deriveProjectNameFromPath } from '../../lib/deriveProjectName'
  import { deriveRepoNameFromUrl } from '../../lib/deriveRepoNameFromUrl'
  import { computeTargetPathPreview, canSubmitGithub } from './projectSetupDialogLogic'
  import Modal from '../shared/ui/Modal.svelte'

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

  let mode = $state<'local' | 'github'>('local')
  let repoUrl = $state('')
  let parentDir = $state('')

  let targetPathPreview = $derived(computeTargetPathPreview(parentDir, deriveRepoNameFromUrl(repoUrl)))

  let canSubmitLocal = $derived(!isSubmitting && path.trim().length > 0 && projectName.trim().length > 0)
  let canSubmitGithubMode = $derived(canSubmitGithub({ repoUrl, parentDir, projectName, isSubmitting }))
  let canSubmit = $derived(mode === 'local' ? canSubmitLocal : canSubmitGithubMode)

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
      } else {
        if (!repoUrl.trim() || !parentDir.trim() || !projectName.trim()) return
        project = await createProjectFromGit({
          url: repoUrl.trim(),
          parentDir: parentDir.trim(),
          name: projectName.trim(),
        })
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
    <div role="tablist" class="tabs tabs-boxed">
      <button
        type="button"
        role="tab"
        class="tab {mode === 'local' ? 'tab-active' : ''}"
        onclick={() => { mode = 'local'; createError = null }}
        disabled={isSubmitting}
      >Local folder</button>
      <button
        type="button"
        role="tab"
        class="tab {mode === 'github' ? 'tab-active' : ''}"
        onclick={() => { mode = 'github'; createError = null }}
        disabled={isSubmitting}
      >From GitHub</button>
    </div>

    <p class="text-sm text-base-content/70 m-0">
      {#if mode === 'github'}
        Paste a GitHub repository URL and OpenForge will clone it and set up the project.
      {:else}
        Connect a local repository so OpenForge can track tasks and agent handoffs for it.
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
          <button
            data-select-repository
            class="btn btn-primary btn-sm w-full"
            type="button"
            onclick={handleSelectRepository}
            disabled={isSubmitting}
          >
            Select Repository
          </button>
          <span class="text-[0.65rem] text-base-content/40">Pick the local git repository for this project. Using the picker lets OpenForge access folders in macOS Documents/Desktop.</span>
        </div>
      {:else}
        <div class="flex flex-col gap-1.5">
          <span id="add-project-repository-label" class="text-xs text-base-content/60 font-medium">Repository</span>
          <div class="flex items-center gap-2">
            <span class="input input-bordered input-sm w-full flex items-center font-mono text-xs truncate" role="group" aria-labelledby="add-project-repository-label" title={path}>{path}</span>
            <button
              data-select-repository
              class="btn btn-ghost btn-sm"
              type="button"
              onclick={handleSelectRepository}
              disabled={isSubmitting}
            >
              Change
            </button>
          </div>
        </div>

        <label class="flex flex-col gap-1.5">
          <span class="text-xs text-base-content/60 font-medium">Project Name <span class="text-error" aria-hidden="true">*</span></span>
          <input
            data-project-name-input
            type="text"
            class="input input-bordered input-sm w-full"
            bind:value={projectName}
            placeholder="My Awesome Project"
            oninput={handleNameInput}
            autocomplete="off"
            aria-describedby={createError || successMessage ? creationFeedbackId : undefined}
          />
        </label>
      {/if}
    {:else}
      <label class="flex flex-col gap-1.5">
        <span class="text-xs text-base-content/60 font-medium">Repository URL <span class="text-error" aria-hidden="true">*</span></span>
        <input
          type="text"
          class="input input-bordered input-sm w-full"
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
          <span class="input input-bordered input-sm w-full flex items-center font-mono text-xs truncate" role="group" aria-labelledby="add-project-parent-label" title={parentDir}>{parentDir || 'No folder selected'}</span>
          <button class="btn btn-ghost btn-sm" type="button" onclick={handleSelectParentFolder} disabled={isSubmitting}>Choose</button>
        </div>
      </div>

      <label class="flex flex-col gap-1.5">
        <span class="text-xs text-base-content/60 font-medium">Project Name <span class="text-error" aria-hidden="true">*</span></span>
        <input
          data-project-name-input
          type="text"
          class="input input-bordered input-sm w-full"
          bind:value={projectName}
          placeholder="My Awesome Project"
          oninput={handleNameInput}
          autocomplete="off"
          aria-describedby={createError || successMessage ? creationFeedbackId : undefined}
        />
      </label>

      {#if targetPathPreview}
        <p class="text-[0.65rem] text-base-content/40 m-0">Will clone into <span class="font-mono">{targetPathPreview}</span></p>
      {/if}
    {/if}
  </form>

  <div class="flex gap-2.5 px-5 py-4 border-t border-base-300 justify-end">
    <button class="btn btn-ghost btn-sm" onclick={close} type="button" disabled={isSubmitting}>Cancel</button>
    <button
      class="btn btn-primary btn-sm"
      form="add-project-form"
      type="submit"
      disabled={!canSubmit}
      aria-describedby={createError || successMessage ? creationFeedbackId : undefined}
    >
      {isSubmitting ? (mode === 'github' ? 'Cloning...' : 'Creating...') : 'Create Project'}
    </button>
  </div>
</Modal>
