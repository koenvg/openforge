<script lang="ts">
  import { onMount } from 'svelte'
  import { ImagePlus } from '@lucide/svelte'
  import type { Task, PermissionMode, Action, GitBranchInfo, WorktreeSource } from '../lib/types'
  import { createTask, updateTask, getResolvedAiProvider, listGitBranches } from '../lib/ipc'
  import {
    formatTaskPromptWithImageReferences,
    getTaskPromptImageReferences,
    getTaskPromptText,
  } from '../lib/taskPrompt'
  import type { TaskPromptImageReference } from '../lib/taskPrompt'
  import { activeProjectId } from '../lib/stores'
  import Modal from './shared/ui/Modal.svelte'
  import SearchableSelect from './shared/ui/SearchableSelect.svelte'
  import PromptInput from './prompt/PromptInput.svelte'
  import { getEnabledActions, loadActions } from '../lib/actions'

  interface Props {
    mode?: 'create' | 'edit'
    task?: Task | null
    projectPath?: string | null
    onClose?: () => void
    onTaskSaved?: (task?: Task) => void | Promise<void>
    onRunAction?: (taskId: string, actionPrompt: string, agent: string | null) => Promise<void>
  }

  interface PastedTaskImage extends TaskPromptImageReference {
    id: number
  }

  const MAX_PASTED_IMAGE_BYTES = 5 * 1024 * 1024

  let { mode = 'create', task = null, projectPath = null, onClose, onTaskSaved, onRunAction }: Props = $props()

  let selectedPermissionMode = $state<PermissionMode>('default')
  let selectedWorktreeSource = $state<WorktreeSource>('newBranchFromMain')
  let selectedExistingBranch = $state('')
  let useWorktree = $state(true)
  let gitBranches = $state<GitBranchInfo[]>([])
  let branchLoadError = $state<string | null>(null)
  let aiProvider = $state<string | null>(null)
  let availableActions = $state<Action[]>([])
  let error = $state<string | null>(null)
  let environmentExpanded = $state(false)
  let promptDraft = $state('')
  let lastInitialPrompt = $state<string | null>(null)
  let showMoreMenu = $state(false)
  let createActionsEl = $state<HTMLElement | null>(null)
  let pastedImages = $state<PastedTaskImage[]>([])
  let previewImage = $state<PastedTaskImage | null>(null)
  let imagePasteError = $state<string | null>(null)
  let imagePastePending = $state(false)
  let imageMarkerInsertRequest = $state<{ id: number, marker: string } | null>(null)
  let loadedPromptSourceKey = $state<string | null>(null)
  let nextPastedImageId = 1
  let nextImageMarkerInsertRequestId = 1
  let taskTitle = $state('')
  let handoffNotesEnabled = $state(true)

  const initialPrompt = $derived(mode === 'edit' && task ? getTaskPromptText(task) : '')
  const promptReady = $derived(promptDraft.trim().length > 0)
  const permissionModeSummary = $derived(getPermissionModeSummary(selectedPermissionMode))
  const workspaceSummary = $derived(getWorkspaceSummary())
  const environmentSummary = $derived(
    `${workspaceSummary} · ${permissionModeSummary}${handoffNotesEnabled ? '' : ' · no handoff notes'}`
  )
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

  function getPermissionModeSummary(mode: PermissionMode): string {
    switch (mode) {
      case 'auto':
        return 'autorun'
      case 'acceptEdits':
        return 'accept edits'
      case 'plan':
        return 'plan only'
      case 'bypassPermissions':
        return 'bypass permissions'
      case 'dontAsk':
        return "don't ask"
      default:
        return 'default permissions'
    }
  }

  function getWorkspaceSummary(): string {
    if (!useWorktree) return 'Project directory'
    if (selectedWorktreeSource === 'existingBranch') {
      return `Worktree · ${selectedExistingBranch.trim() || 'existing branch'}`
    }
    return 'Worktree · latest main'
  }

  function buildWorktreeOptions(): { worktreeSource: WorktreeSource; worktreeBranch: string | null } {
    if (!useWorktree) {
      return { worktreeSource: 'disabled', worktreeBranch: null }
    }

    if (selectedWorktreeSource === 'existingBranch') {
      return { worktreeSource: selectedWorktreeSource, worktreeBranch: selectedExistingBranch.trim() }
    }

    return { worktreeSource: 'newBranchFromMain', worktreeBranch: null }
  }

  onMount(() => {
    document.addEventListener('pointerdown', handleDocumentPointerDown)
    void initializeDialog()
    return () => document.removeEventListener('pointerdown', handleDocumentPointerDown)
  })

  async function initializeDialog() {
    selectedPermissionMode = 'default'
    try {
      if ($activeProjectId) {
        aiProvider = await getResolvedAiProvider($activeProjectId)

        const allActions = await loadActions($activeProjectId)
        availableActions = getEnabledActions(allActions)

        if (projectPath) {
          try {
            gitBranches = await listGitBranches(projectPath)
            selectedExistingBranch = gitBranches.find((branch) => !branch.is_current)?.name ?? gitBranches[0]?.name ?? ''
          } catch (e) {
            console.error('Failed to list git branches:', e)
            branchLoadError = String(e)
            gitBranches = []
            selectedExistingBranch = ''
          }
        } else {
          gitBranches = []
          selectedExistingBranch = ''
        }
      } else {
        aiProvider = 'claude-code'
        availableActions = []
        gitBranches = []
        selectedExistingBranch = ''
      }
    } catch {
      aiProvider = null
      availableActions = []
      gitBranches = []
      selectedExistingBranch = ''
    }
  }

  function handlePromptDraftChange(value: string) {
    promptDraft = value
    if (value.trim().length === 0) showMoreMenu = false
  }

  function toggleMoreMenu() {
    if (!promptReady) return
    showMoreMenu = !showMoreMenu
  }

  function handleMoreMenuKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    showMoreMenu = false
  }

  function handleDocumentPointerDown(e: PointerEvent) {
    if (!showMoreMenu) return
    const target = e.target
    if (!(target instanceof Node)) return
    if (createActionsEl?.contains(target)) return
    showMoreMenu = false
  }

  async function handleStartTaskFromDraft() {
    await handleCreateOrUpdate(promptDraft, '', true)
  }

  async function handleAddToBacklogFromDraft() {
    showMoreMenu = false
    await handleCreateOrUpdate(promptDraft)
  }

  async function handleCustomActionFromDraft(actionPrompt: string) {
    showMoreMenu = false
    await handleCreateOrUpdate(promptDraft, actionPrompt, true)
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

  async function handleCreateOrUpdate(prompt: string, actionPrompt: string | null = null, autoStart: boolean = false) {
    if (!$activeProjectId) return
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt) return
    error = null
    if (imagePastePending) {
      error = 'Wait for the pasted image to finish processing.'
      return
    }

    try {
      let savedTask: Task
      const taskPrompt = promptWithPastedImageReferences(normalizedPrompt)

      if (mode === 'edit' && task) {
        await updateTask(task.id, taskPrompt)
        savedTask = task
        await onTaskSaved?.()
      } else {
        if (useWorktree && selectedWorktreeSource === 'existingBranch' && selectedExistingBranch.trim() === '') {
          error = 'Select an existing branch'
          return
        }

        savedTask = await createTask(
          taskPrompt,
          'backlog',
          $activeProjectId,
          selectedPermissionMode,
          { ...buildWorktreeOptions(), title: taskTitle.trim() || null, handoffNotesEnabled }
        )

        if (autoStart && onRunAction) {
          onClose?.()
          await onRunAction(savedTask.id, actionPrompt || '', null)
          return
        } else {
          await onTaskSaved?.(savedTask)
        }
      }
      onClose?.()
    } catch (e) {
      console.error('Failed to save task:', e)
      error = String(e)
    }
  }
</script>

<Modal onClose={onClose} maxWidth="640px" overflowVisible initialFocus="textarea">
  {#snippet header()}
    <h2 class="text-[0.95rem] font-semibold text-base-content m-0">{mode === 'create' ? 'Create Task' : 'Edit Task'}</h2>
  {/snippet}

  <div class="p-4 overflow-visible">
    {#if error}
      <div class="text-error text-sm mb-4">{error}</div>
    {/if}
    {#if mode === 'create'}
      <input
        type="text"
        class="input input-bordered input-sm mb-3 w-full"
        placeholder="Title (optional)"
        aria-label="Task title"
        bind:value={taskTitle}
      />
    {/if}
    <PromptInput
      projectId={$activeProjectId || ''}
      value={initialPrompt}
      autofocus={false}
      commandTrigger={aiProvider === 'codex' ? 'dollar' : 'slash'}
      onTextChange={syncPastedImagesWithPrompt}
      onPasteImage={attachPastedImage}
      onImageMarkerClick={openImagePreview}
      imageMarkerInsertRequest={imageMarkerInsertRequest}
      onSubmit={(prompt) => mode === 'create' ? handleCreateOrUpdate(prompt, '', true) : handleCreateOrUpdate(prompt)}
      onValueChange={handlePromptDraftChange}
      onCancel={() => onClose?.()}
    >
      {#snippet footerHelp()}
        {#if mode === 'create'}
          <span class="truncate text-xs text-base-content/60">Press ⌘↵ to start, or use More for backlog/templates.</span>
        {/if}
      {/snippet}

      {#snippet controls()}
        {#if mode === 'create'}
          {#if promptReady}
            <div class="relative" bind:this={createActionsEl}>
              <button
                class="btn btn-ghost btn-sm"
                type="button"
                onclick={toggleMoreMenu}
                aria-expanded={showMoreMenu}
                aria-haspopup="menu"
                aria-controls="create-task-more-actions"
                onkeydown={handleMoreMenuKeydown}
              >More</button>

              {#if showMoreMenu}
                <div
                  id="create-task-more-actions"
                  role="menu"
                  class="absolute bottom-[calc(100%+0.5rem)] right-0 z-[100] min-w-48 overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-lg"
                >
                  <button
                    class="block w-full px-3 py-2 text-left text-sm text-base-content hover:bg-base-200 focus:bg-base-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    type="button"
                    role="menuitem"
                    onclick={handleAddToBacklogFromDraft}
                    onkeydown={handleMoreMenuKeydown}
                  >Add to Backlog</button>
                  {#each availableActions as action (action.id)}
                    <button
                      class="block w-full px-3 py-2 text-left text-sm text-base-content hover:bg-base-200 focus:bg-base-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      type="button"
                      role="menuitem"
                      title={action.prompt || action.name}
                      onclick={() => handleCustomActionFromDraft(action.prompt)}
                      onkeydown={handleMoreMenuKeydown}
                    >{action.name}</button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
          <button
            class="btn btn-primary btn-sm"
            type="button"
            disabled={!promptReady}
            onclick={handleStartTaskFromDraft}
            title="⌘Enter"
          >Start Task <kbd class="kbd kbd-xs ml-1 bg-primary-content text-primary border-primary-content/30">⌘↵</kbd></button>
        {:else}
          <span class="text-xs text-base-content opacity-70">⌘Enter to submit</span>
          <button
            class="btn btn-primary btn-sm"
            type="button"
            disabled={!promptReady}
            onclick={() => handleCreateOrUpdate(promptDraft)}
          >Submit</button>
        {/if}
      {/snippet}

      {#snippet extras()}
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-xs min-h-8"
              onclick={pasteImageFromClipboard}
              disabled={imagePastePending}
            >
              <ImagePlus size={14} aria-hidden="true" />
              Paste image
            </button>
            {#if pastedImages.length > 0}
              <span class="text-xs text-base-content/60 truncate" aria-live="polite">{pastedImageSummary}</span>
            {/if}
          </div>
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
            <div class="space-y-2">
              <button
                type="button"
                class="btn btn-outline btn-sm h-auto min-h-8 justify-start gap-2 text-left font-normal"
                aria-expanded={environmentExpanded}
                aria-controls="create-task-environment"
                onclick={() => { environmentExpanded = !environmentExpanded }}
              >
                <span class="text-base-content/50">Environment:</span>
                <span>{environmentSummary}</span>
                <span class="text-base-content/50">{environmentExpanded ? '⌃' : '⌄'}</span>
              </button>

              {#if environmentExpanded}
                <div id="create-task-environment" class="space-y-3 rounded-lg border border-base-300 bg-base-200/50 p-3">
                  {#if aiProvider === 'claude-code'}
                    <div class="flex items-center gap-2">
                      <label for="create-task-permission-mode" class="text-xs font-medium text-base-content/50 shrink-0">Mode</label>
                      <select
                        id="create-task-permission-mode"
                        class="select select-bordered select-xs flex-1"
                        bind:value={selectedPermissionMode}
                      >
                        <option value="default">Default</option>
                        <option value="auto">Autorun</option>
                        <option value="acceptEdits">Accept Edits</option>
                        <option value="plan">Plan</option>
                        <option value="bypassPermissions">Bypass Permissions</option>
                        <option value="dontAsk">Don't Ask (dangerous)</option>
                      </select>
                    </div>
                  {/if}

                  <div class="grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
                    <span class="pt-1.5 text-xs font-medium text-base-content/50">Workspace</span>

                    <div class="min-w-0 space-y-2">
                      <div class="flex min-h-7 items-center justify-between gap-3">
                        <label class="flex min-w-0 items-center gap-2 text-xs font-medium text-base-content/80">
                          <input
                            type="checkbox"
                            class="toggle toggle-primary toggle-xs"
                            aria-label="Worktree"
                            bind:checked={useWorktree}
                          />
                          <span>Worktree</span>
                        </label>

                        {#if !useWorktree}
                          <span class="badge badge-ghost badge-xs shrink-0">Project directory</span>
                        {/if}
                      </div>

                      {#if useWorktree}
                        <div class="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2">
                          <span class="text-xs font-medium text-base-content/50">Base</span>
                          <div
                            role="radiogroup"
                            aria-label="Worktree source"
                            class="join grid min-w-0 grid-cols-2"
                          >
                            <label
                              class="btn join-item btn-xs h-8 min-h-8 flex-1 text-xs focus-within:ring-2 focus-within:ring-primary"
                              class:btn-primary={selectedWorktreeSource === 'newBranchFromMain'}
                              class:btn-ghost={selectedWorktreeSource !== 'newBranchFromMain'}
                              class:border-base-300={selectedWorktreeSource !== 'newBranchFromMain'}
                              class:bg-base-100={selectedWorktreeSource !== 'newBranchFromMain'}
                            >
                              <input
                                type="radio"
                                class="sr-only"
                                aria-label="New branch from latest main"
                                bind:group={selectedWorktreeSource}
                                value="newBranchFromMain"
                              />
                              <span>Latest main</span>
                            </label>
                            <label
                              class="btn join-item btn-xs h-8 min-h-8 flex-1 text-xs focus-within:ring-2 focus-within:ring-primary"
                              class:btn-primary={selectedWorktreeSource === 'existingBranch'}
                              class:btn-ghost={selectedWorktreeSource !== 'existingBranch'}
                              class:border-base-300={selectedWorktreeSource !== 'existingBranch'}
                              class:bg-base-100={selectedWorktreeSource !== 'existingBranch'}
                            >
                              <input
                                type="radio"
                                class="sr-only"
                                aria-label="Existing branch"
                                bind:group={selectedWorktreeSource}
                                value="existingBranch"
                              />
                              <span>Existing branch</span>
                            </label>
                          </div>
                        </div>

                        {#if selectedWorktreeSource === 'existingBranch'}
                          <div class="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2">
                            <span class="text-xs font-medium text-base-content/50">Branch</span>
                            {#if gitBranches.length === 0}
                              <div
                                class="select select-bordered select-xs flex min-w-0 flex-1 items-center text-base-content/40"
                                aria-label="Branch"
                              >
                                No branches available
                              </div>
                            {:else}
                              <div class="min-w-0">
                                <SearchableSelect
                                  ariaLabel="Branch"
                                  size="xs"
                                  placeholder="Search branches…"
                                  options={gitBranches.map((branch) => ({
                                    value: branch.name,
                                    label: `${branch.name}${branch.is_remote ? ' (remote)' : ''}`,
                                  }))}
                                  value={selectedExistingBranch}
                                  onSelect={(value) => { selectedExistingBranch = value }}
                                />
                              </div>
                            {/if}
                          </div>
                          {#if branchLoadError}
                            <span class="mt-1 block text-xs text-error">{branchLoadError}</span>
                          {/if}
                        {/if}
                      {/if}
                    </div>
                  </div>

                  <div class="grid grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
                    <span class="text-xs font-medium text-base-content/50">Handoff</span>
                    <label class="flex min-w-0 items-center gap-2 text-xs font-medium text-base-content/80">
                      <input
                        type="checkbox"
                        class="toggle toggle-primary toggle-xs"
                        aria-label="Handoff notes"
                        bind:checked={handoffNotesEnabled}
                      />
                      <span>Include handoff notes</span>
                    </label>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/snippet}
    </PromptInput>
  </div>
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
