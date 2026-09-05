<script lang="ts">
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
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
    <p class="text-[0.7rem] text-[var(--of-text-muted)] mb-2 leading-snug">
      Manage the project labels available for tasks.
    </p>

    <div class="flex items-end gap-2">
      <div class="flex-1">
      <TextField label="New task label"
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
      </div>
      <Button
        type="button"
        variant="primary" size="sm"
        disabled={disabled || isSaving || !labelInput.trim()}
        onclick={handleCreateLabel}
      >
        Add Label
      </Button>
    </div>

    {#if error}
      <p class="text-sm text-[var(--of-danger)] m-0" role="alert">{error}</p>
    {/if}

    {#if isLoading}
      <p class="text-sm text-[var(--of-text-muted)] m-0">Loading labels…</p>
    {:else if labels.length === 0}
      <p class="text-sm text-[var(--of-text-muted)] m-0">No task labels yet.</p>
    {:else}
      <div class="flex flex-col gap-2" aria-label="Project task labels">
        {#each labels as label (label.id)}
          <Panel padding="none" variant="subtle">
            <div class="flex items-center justify-between gap-2 p-2">
            <Badge variant="info" class="max-w-full truncate">{label.name}</Badge>
            <IconButton
              type="button"
              variant="danger" size="xs"
              disabled={disabled || isSaving}
              label="Delete task label {label.name}"
              onclick={() => handleDeleteLabel(label)}
            >
              <Trash2 size={14} aria-hidden="true" />
            </IconButton>
          </div>
          </Panel>
        {/each}
      </div>
    {/if}
  </div>
</SettingsSectionCard>
