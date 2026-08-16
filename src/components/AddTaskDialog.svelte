<script lang="ts">
  import { onMount } from 'svelte'
  import { ImagePlus } from '@lucide/svelte'
  import type { Task, GitBranchInfo } from '../lib/types'
  import { createTask, updateTaskInitialPrompt, listGitBranches, repoHasCommits } from '../lib/ipc'
  import { loadTaskLevelDefaults } from '../lib/taskDefaults'
  import { HIERARCHICAL_SETTINGS } from '../lib/hierarchicalSettings'
  import { dedupeBranchesForSelector } from '../lib/branchSelector'
  import { resolveWorktreeAvailability } from '../lib/worktreeAvailability'
  import {
    formatTaskPromptWithImageReferences,
    getTaskPromptImageReferences,
    getTaskPromptText,
  } from '../lib/taskPrompt'
  import type { TaskPromptImageReference } from '../lib/taskPrompt'
  import { activeProjectId } from '../lib/stores'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import PromptInput from './prompt/PromptInput.svelte'
  import VoiceInput from './shared/adapters/VoiceInput.svelte'
  import InjectionPointSlot from './plugin/InjectionPointSlot.svelte'
  import CreateTaskSettings from './create-task/CreateTaskSettings.svelte'
  import { createTaskDraft, getWorktreeOptions } from './create-task/createTaskDraft'
  import type { InjectionPointLocation } from '@openforge-app/plugin-sdk'

  interface Props {
    mode?: 'create' | 'edit'
    task?: Task | null
    projectPath?: string | null
    projectName?: string | null
    onClose?: () => void
    onTaskSaved?: (task?: Task) => void | Promise<void>
    onRunAction?: (taskId: string, actionPrompt: string, agent: string | null) => Promise<void>
  }

  interface PastedTaskImage extends TaskPromptImageReference {
    id: number
  }

  const MAX_PASTED_IMAGE_BYTES = 5 * 1024 * 1024
  // Provider choices come from the shared settings registry so the task-level
  // control never drifts from the global/project provider options.
  const aiProviderOptions = HIERARCHICAL_SETTINGS.find((setting) => setting.key === 'ai_provider')?.options ?? []

  let { mode = 'create', task = null, projectPath = null, projectName = null, onClose, onTaskSaved, onRunAction }: Props = $props()
  const dialogTitle = $derived(mode === 'create' ? 'Create task' : 'Edit task')

  let draft = $state(createTaskDraft())
  // False when the selected repo has no commits yet (unborn HEAD): a worktree
  // cannot branch from a repo with no base commit, so the toggle is disabled and
  // the task falls back to running in the project directory.
  let worktreeAllowed = $state(true)
  let gitBranches = $state<GitBranchInfo[]>([])
  let branchLoadError = $state<string | null>(null)
  let error = $state<string | null>(null)
  let promptDraft = $state('')
  let promptEditor = $state<{ insertText: (text: string) => void } | null>(null)
  let lastInitialPrompt = $state<string | null>(null)
  let isSaving = $state(false)
  let submissionIntent = $state<'backlog' | 'start' | null>(null)
  let pastedImages = $state<PastedTaskImage[]>([])
  let previewImage = $state<PastedTaskImage | null>(null)
  let imagePasteError = $state<string | null>(null)
  let imagePastePending = $state(false)
  let imageMarkerInsertRequest = $state<{ id: number, marker: string } | null>(null)
  let injectableInsertRequest = $state<{ id: number, text: string } | null>(null)
  let loadedPromptSourceKey = $state<string | null>(null)
  let nextPastedImageId = 1
  let nextImageMarkerInsertRequestId = 1
  let nextInjectableInsertRequestId = 1
  let injectionLocation = $derived<InjectionPointLocation>(mode === 'create' ? 'createTaskPrompt' : 'backlogPrompt')
  let taskDefaultsLoading = $state(true)

  const initialPrompt = $derived(mode === 'edit' && task ? getTaskPromptText(task) : '')
  const promptReady = $derived(promptDraft.trim().length > 0)
  const createReady = $derived((mode !== 'create' || !taskDefaultsLoading) && !isSaving)
  let pastedImageSummary = $derived(
    pastedImages.length === 0
      ? ''
      : `${pastedImages.length} image${pastedImages.length === 1 ? '' : 's'} ready`
  )

  $effect(() => {
    if (initialPrompt === lastInitialPrompt) return
    promptDraft = initialPrompt
    lastInitialPrompt = initialPrompt
  })


  onMount(() => {
    void initializeDialog()
  })

  async function initializeDialog() {
    draft = createTaskDraft()
    taskDefaultsLoading = mode === 'create'
    worktreeAllowed = true
    branchLoadError = null

    try {
      if (!$activeProjectId) {
        draft.aiProvider = 'claude-code'
        gitBranches = []
        return
      }

      const defaults = await loadTaskLevelDefaults($activeProjectId)
      Object.assign(draft, {
        codeCleanupEnabled: defaults.codeCleanupEnabled,
        taskDisplayTitleUpdatesEnabled: defaults.taskDisplayTitleUpdatesEnabled,
        handoffNotesEnabled: defaults.handoffNotesEnabled,
        aiProvider: defaults.aiProvider,
        useWorktree: defaults.useWorktrees,
      })

      if (!projectPath) {
        gitBranches = []
        return
      }

      let hasCommits = true
      try {
        hasCommits = await repoHasCommits(projectPath)
      } catch (lookupError) {
        console.error('Failed to check whether repo has commits:', lookupError)
      }

      const availability = resolveWorktreeAvailability(hasCommits, defaults.useWorktrees)
      worktreeAllowed = availability.worktreeAllowed
      draft.useWorktree = availability.useWorktree

      try {
        gitBranches = await listGitBranches(projectPath)
        const options = dedupeBranchesForSelector(gitBranches)
        const currentNames = new Set(
          gitBranches.filter((branch) => branch.is_current).map((branch) => branch.name),
        )
        const preferred = options.find((option) => !currentNames.has(option.value)) ?? options[0]
        draft.existingBranch = preferred?.value ?? ''
      } catch (branchError) {
        console.error('Failed to list git branches:', branchError)
        branchLoadError = String(branchError)
        gitBranches = []
        draft.existingBranch = ''
      }
    } catch {
      draft.aiProvider = null
      gitBranches = []
      draft.existingBranch = ''
      worktreeAllowed = true
    } finally {
      taskDefaultsLoading = false
    }
  }

  function handlePromptDraftChange(value: string) {
    promptDraft = value
  }

  async function handleStartTaskFromDraft() {
    await handleCreateOrUpdate(promptDraft, true)
  }

  async function handleAddToBacklogFromDraft() {
    await handleCreateOrUpdate(promptDraft)
  }

  function markerId(marker: string): number {
    return Number(marker.match(/\[image#(\d+)\]/)?.[1] ?? '0')
  }

  function taskPromptSourceKey(): string {
    if (mode !== 'edit' || !task) return 'create'
    return `${task.id}\u0000${task.prompt ?? ''}\u0000${task.initial_prompt ?? ''}`
  }

  function imageFromReference(reference: TaskPromptImageReference): PastedTaskImage {
    return {
      ...reference,
      id: markerId(reference.marker),
    }
  }

  $effect(() => {
    const sourceKey = taskPromptSourceKey()
    if (sourceKey === loadedPromptSourceKey) return

    loadedPromptSourceKey = sourceKey
    previewImage = null
    imagePasteError = null
    imageMarkerInsertRequest = null

    if (mode === 'edit' && task) {
      const promptText = getTaskPromptText(task)
      const restoredImages = getTaskPromptImageReferences(task)
        .filter((image) => promptText.includes(image.marker))
        .map(imageFromReference)
      pastedImages = restoredImages
      nextPastedImageId = Math.max(0, ...restoredImages.map((image) => image.id)) + 1
      return
    }

    pastedImages = []
    nextPastedImageId = 1
  })

  function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  function readBlobAsDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result)
        } else {
          reject(new Error('Failed to read image'))
        }
      }
      reader.readAsDataURL(blob)
    })
  }

  async function attachPastedImage(blob: Blob): Promise<string | null> {
    imagePasteError = null
    imagePastePending = true
    const mimeType = blob.type || 'image/png'
    if (!mimeType.startsWith('image/')) {
      imagePasteError = 'Clipboard item is not an image.'
      imagePastePending = false
      return null
    }
    if (blob.size > MAX_PASTED_IMAGE_BYTES) {
      imagePasteError = `Pasted image is too large. Keep images under ${formatBytes(MAX_PASTED_IMAGE_BYTES)}.`
      imagePastePending = false
      return null
    }

    try {
      const dataUrl = await readBlobAsDataUrl(blob)
      const id = nextPastedImageId
      nextPastedImageId += 1
      const marker = `[image#${id}]`
      pastedImages = [...pastedImages, { id, marker, dataUrl, mimeType, size: blob.size }]
      return marker
    } catch {
      imagePasteError = 'Could not read the pasted image.'
      return null
    } finally {
      imagePastePending = false
    }
  }

  async function pasteImageFromClipboard() {
    imagePasteError = null
    imagePastePending = true

    try {
      if (!navigator.clipboard?.read) {
        imagePasteError = 'Clipboard image paste is unavailable here.'
        return
      }

      const items = await navigator.clipboard.read()
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'))
        if (imageType) {
          const marker = await attachPastedImage(await item.getType(imageType))
          if (marker) {
            imageMarkerInsertRequest = {
              id: nextImageMarkerInsertRequestId,
              marker,
            }
            nextImageMarkerInsertRequestId += 1
          }
          return
        }
      }
      imagePasteError = 'Clipboard does not contain an image.'
    } catch {
      imagePasteError = 'Could not read an image from the clipboard.'
    } finally {
      imagePastePending = false
    }
  }

  function openImagePreview(marker: string) {
    previewImage = pastedImages.find((image) => image.marker === marker) ?? null
  }

  function syncPastedImagesWithPrompt(prompt: string) {
    const retainedImages = pastedImages.filter((image) => prompt.includes(image.marker))
    if (retainedImages.length === pastedImages.length) return

    pastedImages = retainedImages
    if (previewImage && !retainedImages.some((image) => image.marker === previewImage?.marker)) {
      previewImage = null
    }
  }

  function promptWithPastedImageReferences(prompt: string): string {
    return formatTaskPromptWithImageReferences(prompt, pastedImages)
  }

  async function handleCreateOrUpdate(prompt: string, autoStart: boolean = false) {
    if (!$activeProjectId) return
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt) return
    error = null
    if (mode === 'create' && taskDefaultsLoading) {
      error = 'Task defaults are still loading.'
      return
    }
    if (imagePastePending) {
      error = 'Wait for the pasted image to finish processing.'
      return
    }
    if (isSaving) return
    if (mode === 'create' && draft.useWorktree && draft.worktreeSource === 'existingBranch' && draft.existingBranch.trim() === '') {
      error = 'Select an existing branch before creating the task.'
      return
    }

    submissionIntent = mode === 'create' ? (autoStart ? 'start' : 'backlog') : null
    isSaving = true
    try {
      let savedTask: Task
      const taskPrompt = promptWithPastedImageReferences(normalizedPrompt)

      if (mode === 'edit' && task) {
        await updateTaskInitialPrompt(task.id, taskPrompt)
        savedTask = task
        await onTaskSaved?.()
      } else {

        savedTask = await createTask(
          taskPrompt,
          'backlog',
          $activeProjectId,
          draft.permissionMode,
          {
            ...getWorktreeOptions(draft),
            title: draft.title.trim() || null,
            handoffNotesEnabled: draft.handoffNotesEnabled,
            sourceTicketUrl: draft.sourceTicketUrl.trim() || null,
            codeCleanupEnabled: draft.codeCleanupEnabled,
            taskDisplayTitleUpdatesEnabled: draft.taskDisplayTitleUpdatesEnabled,
            aiProvider: draft.aiProvider,
          }
        )

        if (autoStart && onRunAction) {
          onClose?.()
          await onRunAction(savedTask.id, '', null)
          return
        } else {
          await onTaskSaved?.(savedTask)
        }
      }
      onClose?.()
    } catch (e) {
      console.error('Failed to save task:', e)
      error = String(e)
    } finally {
      isSaving = false
      submissionIntent = null
    }
  }
</script>

<Modal
  onClose={onClose}
  maxWidth="720px"
  overflowVisible
  initialFocus="textarea"
  ariaLabel={dialogTitle}
  boxClass="rounded-xl border border-base-300"
>
  {#snippet header()}
    <div class="flex min-w-0 flex-1 items-center justify-between gap-4 pr-3">
      <h2 class="m-0 text-2xl font-semibold tracking-[-0.02em] text-base-content">{dialogTitle}</h2>
      {#if mode === 'create'}
        <div class="min-w-0 text-right">
          <span class="block max-w-56 truncate text-sm font-medium text-base-content">{projectName ?? 'Current project'}</span>
        </div>
      {/if}
    </div>
  {/snippet}

  <div class="max-h-[calc(90vh-4rem)] overflow-y-auto p-6">
    {#if error}
      <div class="mb-4 rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-sm text-error" role="alert">{error}</div>
    {/if}

    <InjectionPointSlot
      location={injectionLocation}
      projectId={$activeProjectId}
      taskId={mode === 'edit' && task ? task.id : null}
      onInsert={(text) => {
        injectableInsertRequest = { id: nextInjectableInsertRequestId, text }
        nextInjectableInsertRequestId += 1
      }}
    />
    <label class="mb-2 block text-sm font-semibold text-base-content" for="create-task-prompt">What should the agent do?</label>
    <div class="relative overflow-visible rounded-xl border border-base-300 bg-base-100 transition-colors focus-within:border-primary">
      <PromptInput
        bind:this={promptEditor}
        projectId={$activeProjectId || ''}
        value={initialPrompt}
        textareaId="create-task-prompt"
        ariaLabel="What should the agent do?"
        rows={8}
        textareaClass="p-4 pb-9 text-sm leading-relaxed"
        textareaStyle="height: 12rem; max-height: 12rem; overflow-y: auto; outline: none;"
        maxLength={10000}
        placeholder="Describe the outcome you want…"
        autofocus={false}
        commandTrigger={draft.aiProvider === 'codex' ? 'dollar' : 'slash'}
        onTextChange={syncPastedImagesWithPrompt}
        onPasteImage={attachPastedImage}
        onImageMarkerClick={openImagePreview}
        imageMarkerInsertRequest={imageMarkerInsertRequest}
        injectableInsertRequest={injectableInsertRequest}
        onSubmit={(prompt) => mode === 'create' ? handleCreateOrUpdate(prompt, true) : handleCreateOrUpdate(prompt)}
        onValueChange={handlePromptDraftChange}
        onCancel={() => onClose?.()}
      />
      <span class="pointer-events-none absolute bottom-3 right-4 text-xs tabular-nums text-base-content/45">{promptDraft.length.toLocaleString()} / 10,000</span>
    </div>
    <p class="mt-2 text-xs text-base-content/55">Be specific about the goal, constraints, and relevant context.</p>

    <div class="flex items-center gap-3 py-4">
      <button
        type="button"
        class="btn btn-outline h-10 min-h-10 px-4"
        onclick={pasteImageFromClipboard}
        disabled={imagePastePending}
      >
        <ImagePlus size={16} aria-hidden="true" />
        Attach image
      </button>
      <VoiceInput
        onTranscription={(text) => promptEditor?.insertText(text)}
        listenToHotkey
        showLabel
        appearance="outline"
        size="md"
      />
      {#if pastedImages.length > 0}
        <span class="truncate text-xs text-base-content/60" aria-live="polite">{pastedImageSummary}</span>
      {/if}
    </div>

    <div class="flex flex-col gap-2 pb-4">
      {#if pastedImages.length > 0}
        <div class="flex flex-wrap items-center gap-1" aria-label="Pasted image markers">
          {#each pastedImages as image (image.id)}
            <button
              type="button"
              class="btn btn-outline btn-xs"
              aria-label="Preview {image.marker}"
              onclick={() => { previewImage = image }}
            >{image.marker}</button>
          {/each}
        </div>
      {/if}
      {#if imagePasteError}
        <p class="m-0 text-xs text-error" role="status" aria-live="polite">{imagePasteError}</p>
      {/if}
      {#if mode === 'create'}
        <CreateTaskSettings
          bind:draft
          {worktreeAllowed}
          {gitBranches}
          {branchLoadError}
          {aiProviderOptions}
        />
      {/if}
    </div>
  </div>

  <footer class="flex items-center justify-between gap-4 border-t border-base-300 bg-base-100 px-6 py-4">
    <div class="flex min-w-0 items-center gap-3">
      <button type="button" class="btn btn-ghost h-10 min-h-10 gap-2 px-0 hover:bg-transparent" aria-label="Close" onclick={() => onClose?.()}>
        <kbd class="kbd kbd-sm border-base-300 bg-base-100">Esc</kbd>
        Close
      </button>
      {#if mode === 'create' && taskDefaultsLoading}
        <span class="truncate text-xs text-base-content/55">Loading task defaults…</span>
      {/if}
    </div>

    <div class="flex shrink-0 items-center gap-2">
      {#if mode === 'create'}
        <button
          class="btn btn-outline h-10 min-h-10 px-4"
          type="button"
          disabled={!promptReady || !createReady}
          onclick={handleAddToBacklogFromDraft}
        >{submissionIntent === 'backlog' ? 'Adding…' : 'Add to backlog'}</button>
        <button
          class="btn btn-primary h-10 min-h-10 min-w-36 px-5"
          type="button"
          disabled={!promptReady || !createReady}
          onclick={handleStartTaskFromDraft}
          title="Command+Enter"
        >
          {submissionIntent === 'start' ? 'Starting…' : 'Start Task'}
          {#if submissionIntent !== 'start'}
            <kbd class="kbd kbd-xs ml-1 border-primary-content/30 bg-primary-content text-primary">⌘↵</kbd>
          {/if}
        </button>
      {:else}
        <span class="text-xs text-base-content opacity-70">⌘Enter to submit</span>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          disabled={!promptReady || !createReady}
          onclick={() => handleCreateOrUpdate(promptDraft)}
        >{isSaving ? 'Saving…' : 'Submit'}</button>
      {/if}
    </div>
  </footer>
</Modal>

{#if previewImage}
  <Modal onClose={() => { previewImage = null }} maxWidth="720px" ariaLabel="Pasted image {previewImage.marker}" initialFocus={null}>
    {#snippet header()}
      <h3 class="text-[0.95rem] font-semibold text-base-content m-0">Pasted image {previewImage.marker}</h3>
    {/snippet}

    <div class="p-4 flex flex-col gap-3">
      <img
        src={previewImage.dataUrl}
        alt="Pasted image {previewImage.marker}"
        class="max-h-[70vh] w-full object-contain rounded border border-base-300 bg-base-200"
      />
      <p class="m-0 text-xs text-base-content/60">{previewImage.mimeType} · {formatBytes(previewImage.size)}</p>
    </div>
  </Modal>
{/if}
