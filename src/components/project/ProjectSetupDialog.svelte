<script lang="ts">
  import { tick } from 'svelte'
  import type { Project } from '../../lib/types'
  import { createProject, selectDirectory } from '../../lib/ipc'
  import { deriveProjectNameFromPath } from '../../lib/deriveProjectName'
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

  let canSubmit = $derived(!isSubmitting && path.trim().length > 0 && projectName.trim().length > 0)

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

  async function handleSubmit() {
    createError = null
    successMessage = null
    if (!path.trim() || !projectName.trim()) return

    isSubmitting = true
    try {
      const project = await createProject(projectName.trim(), path.trim())
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
    <p class="text-sm text-base-content/70 m-0">Connect a local repository so OpenForge can track tasks and agent handoffs for it.</p>

    {#if createError}
      <div id={creationFeedbackId} class="alert alert-error py-2 text-sm" role="alert">
        <span>{createError}</span>
      </div>
    {:else if successMessage}
      <div id={creationFeedbackId} class="alert alert-success py-2 text-sm" role="status">
        <span>{successMessage}</span>
      </div>
    {/if}

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
      {isSubmitting ? 'Creating...' : 'Create Project'}
    </button>
  </div>
</Modal>
