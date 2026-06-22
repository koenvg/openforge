<script lang="ts">
  import { tick } from 'svelte'
  import type { Project } from '../../lib/types'
  import { createProject, selectDirectory } from '../../lib/ipc'
  import Modal from '../shared/ui/Modal.svelte'

  interface Props {
    onClose?: () => void
    onProjectCreated?: (project: Project) => void | Promise<void>
  }

  let { onClose, onProjectCreated }: Props = $props()

  let projectName = $state('')
  let path = $state('')
  let isSubmitting = $state(false)
  let validationMessages = $state<string[]>([])
  let createError = $state<string | null>(null)
  let successMessage = $state<string | null>(null)

  const validationFeedbackId = 'add-project-validation-feedback'
  const creationFeedbackId = 'add-project-creation-feedback'

  function getFailureMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message
    return String(error || 'Failed to create project')
  }

  function validateFields(): string[] {
    const messages: string[] = []
    if (!projectName.trim()) messages.push('Project name is required')
    if (!path.trim()) messages.push('Repository path is required')
    return messages
  }

  function refreshValidationFeedback() {
    if (validationMessages.length > 0) {
      validationMessages = validateFields()
    }
    if (createError) {
      createError = null
    }
  }

  async function handleBrowseRepository() {
    try {
      const selectedPath = await selectDirectory({
        defaultPath: path.trim() || undefined,
        buttonLabel: 'Use Repository',
        message: 'Select the local git repository for this project.',
      })
      if (selectedPath) {
        path = selectedPath
        validationMessages = validateFields()
      }
    } catch (e) {
      createError = getFailureMessage(e)
      console.error('Failed to select repository directory:', e)
    }
  }

  async function handleSubmit() {
    createError = null
    successMessage = null
    validationMessages = validateFields()
    if (validationMessages.length > 0) return

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

<Modal ariaLabel="Add Project" closeLabel="Close Add Project" closeDisabled={isSubmitting} onClose={close} maxWidth="550px" initialFocus="[data-project-name-input]">
  {#snippet header()}
    <h2 class="text-[0.95rem] font-semibold text-base-content m-0">Add Project</h2>
  {/snippet}

  <form id="add-project-form" class="flex-1 overflow-y-auto p-5 flex flex-col gap-4" onsubmit={(e: SubmitEvent) => { e.preventDefault(); void handleSubmit() }}>
    <p class="text-sm text-base-content/70 m-0">Connect a local repository so OpenForge can track tasks and agent handoffs for it.</p>

    {#if validationMessages.length > 0}
      <div id={validationFeedbackId} class="alert alert-error py-2 text-sm" role="alert">
        <span>{validationMessages.join('. ')}</span>
      </div>
    {/if}

    {#if createError}
      <div id={creationFeedbackId} class="alert alert-error py-2 text-sm" role="alert">
        <span>{createError}</span>
      </div>
    {:else if successMessage}
      <div id={creationFeedbackId} class="alert alert-success py-2 text-sm" role="status">
        <span>{successMessage}</span>
      </div>
    {/if}

    <label class="flex flex-col gap-1.5">
      <span class="text-xs text-base-content/60 font-medium">Project Name <span class="text-error" aria-hidden="true">*</span></span>
      <input
        data-project-name-input
        type="text"
        class="input input-bordered input-sm w-full"
        bind:value={projectName}
        placeholder="My Awesome Project"
        oninput={refreshValidationFeedback}
        autocomplete="off"
        aria-invalid={validationMessages.some((message) => message.includes('Project name')) ? 'true' : undefined}
        aria-describedby={validationMessages.length > 0 ? validationFeedbackId : undefined}
      />
    </label>

    <label class="flex flex-col gap-1.5">
      <span class="text-xs text-base-content/60 font-medium">Local Repository Path <span class="text-error" aria-hidden="true">*</span></span>
      <div class="flex gap-2">
        <input
          type="text"
          class="input input-bordered input-sm w-full"
          bind:value={path}
          placeholder="/Users/you/workspace/my-project"
          oninput={refreshValidationFeedback}
          aria-invalid={validationMessages.some((message) => message.includes('Repository path')) ? 'true' : undefined}
          aria-describedby={validationMessages.length > 0 ? validationFeedbackId : undefined}
        />
        <button class="btn btn-outline btn-sm" type="button" onclick={handleBrowseRepository} disabled={isSubmitting}>Browse…</button>
      </div>
      <span class="text-[0.65rem] text-base-content/40">Absolute path to the git repository on your machine. Use Browse for folders in macOS Documents/Desktop so OpenForge can be granted access.</span>
    </label>
  </form>

  <div class="flex gap-2.5 px-5 py-4 border-t border-base-300 justify-end">
    <button class="btn btn-ghost btn-sm" onclick={close} type="button" disabled={isSubmitting}>Cancel</button>
    <button
      class="btn btn-primary btn-sm"
      form="add-project-form"
      type="submit"
      disabled={isSubmitting}
      aria-describedby={createError || successMessage ? creationFeedbackId : undefined}
    >
      {isSubmitting ? 'Creating...' : 'Create Project'}
    </button>
  </div>
</Modal>
