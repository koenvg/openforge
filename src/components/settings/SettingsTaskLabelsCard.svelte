<script lang="ts">
  import { Tags, Trash2 } from '@lucide/svelte'
  import { createTaskLabel, deleteTaskLabel, getProjectTaskLabels } from '../../lib/ipc'
  import type { TaskLabel } from '../../lib/types'
  import { hasLabelNamed, normalizeTaskLabelNameInput, validateTaskLabelName } from '../../lib/taskLabels'
  import SettingsSectionCard from './SettingsSectionCard.svelte'

  interface Props {
    projectId: string | null
    disabled: boolean
  }

  let { projectId, disabled }: Props = $props()

  let labels = $state<TaskLabel[]>([])
  let labelInput = $state('')
  let error = $state<string | null>(null)
  let isLoading = $state(false)
  let isSaving = $state(false)
  let loadRequestId = 0

  $effect(() => {
    const currentProjectId = projectId
    const requestId = ++loadRequestId
    error = null

    if (!currentProjectId) {
      labels = []
      isLoading = false
      return
    }

    isLoading = true
    getProjectTaskLabels(currentProjectId)
      .then((loadedLabels) => {
        if (requestId === loadRequestId) labels = loadedLabels
      })
      .catch((e) => {
        if (requestId !== loadRequestId) return
        labels = []
        error = e instanceof Error ? e.message : String(e)
      })
      .finally(() => {
        if (requestId === loadRequestId) isLoading = false
      })
  })

  async function handleCreateLabel() {
    if (!projectId || disabled || isSaving) return
    const name = normalizeTaskLabelNameInput(labelInput)
    const validationError = validateTaskLabelName(name)
    if (validationError) {
      error = validationError
      return
    }
    if (hasLabelNamed(labels, name)) {
      error = 'Label already exists'
      return
    }

    isSaving = true
    error = null
    try {
      const label = await createTaskLabel(projectId, name)
      labels = [...labels, label].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
      labelInput = ''
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      isSaving = false
    }
  }

  async function handleDeleteLabel(label: TaskLabel) {
    if (disabled || isSaving) return
    if (!confirm(`Delete task label "${label.name}"? It will be removed from every task.`)) return

    isSaving = true
    error = null
    try {
      await deleteTaskLabel(label.id)
      labels = labels.filter((currentLabel) => currentLabel.id !== label.id)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      isSaving = false
    }
  }
</script>

<SettingsSectionCard id="section-labels" title="Task Labels" {disabled}>
  {#snippet icon()}<Tags size={16} />{/snippet}
  <div class="flex flex-col gap-3">
    <p class="text-[0.7rem] text-base-content/50 mb-2 leading-snug">
      Manage the project labels available for tasks.
    </p>

    <div class="flex items-center gap-2">
      <input
        class="input input-bordered input-sm flex-1"
        aria-label="New task label"
        placeholder="New label name"
        value={labelInput}
        disabled={disabled || isSaving}
        oninput={(event) => { labelInput = event.currentTarget.value; error = null }}
        onkeydown={(event: KeyboardEvent) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void handleCreateLabel()
          }
        }}
      />
      <button
        type="button"
        class="btn btn-sm bg-neutral text-neutral-content"
        disabled={disabled || isSaving || !labelInput.trim()}
        onclick={handleCreateLabel}
      >
        Add Label
      </button>
    </div>

    {#if error}
      <p class="text-sm text-error m-0">{error}</p>
    {/if}

    {#if isLoading}
      <p class="text-sm text-base-content/60 m-0">Loading labels…</p>
    {:else if labels.length === 0}
      <p class="text-sm text-base-content/60 m-0">No task labels yet.</p>
    {:else}
      <div class="flex flex-col gap-2" aria-label="Project task labels">
        {#each labels as label (label.id)}
          <div class="flex items-center justify-between gap-2 rounded-md border border-base-300 bg-base-200 p-2">
            <span class="badge badge-sm badge-info badge-outline max-w-full truncate">{label.name}</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs text-base-content/60 hover:bg-error hover:text-error-content"
              disabled={disabled || isSaving}
              aria-label="Delete task label {label.name}"
              onclick={() => handleDeleteLabel(label)}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</SettingsSectionCard>
