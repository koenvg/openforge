<script lang="ts">
  import { getProjectTaskLabels } from '../../../lib/ipc'
  import type { TaskLabel } from '../../../lib/types'
  import { hasLabelNamed } from '../../../lib/taskLabels'

  interface Props {
    projectId: string | null
    selectedLabels: TaskLabel[]
    onAdd: (label: TaskLabel | string) => void | Promise<void>
    onRemove: (label: TaskLabel) => void | Promise<void>
  }

  let { projectId, selectedLabels, onAdd, onRemove }: Props = $props()

  let availableLabels = $state<TaskLabel[]>([])
  let labelInput = $state('')
  let isAdding = $state(false)
  let labelLoadRequest = 0

  let trimmedLabelInput = $derived(labelInput.trim())
  let visibleAvailableLabels = $derived(
    availableLabels.filter((label) => {
      if (hasLabelNamed(selectedLabels, label.name)) return false
      const query = trimmedLabelInput.toLocaleLowerCase()
      return !query || label.name.toLocaleLowerCase().includes(query)
    })
  )
  let canCreateLabel = $derived(
    projectId !== null &&
    trimmedLabelInput !== '' &&
    !hasLabelNamed(selectedLabels, trimmedLabelInput) &&
    visibleAvailableLabels.length === 0
  )

  $effect(() => {
    const currentProjectId = projectId
    if (!currentProjectId) {
      availableLabels = []
      return
    }

    const requestId = ++labelLoadRequest
    getProjectTaskLabels(currentProjectId)
      .then((labels) => {
        if (requestId === labelLoadRequest) availableLabels = labels
      })
      .catch(() => {
        if (requestId === labelLoadRequest) availableLabels = []
      })
  })

  function openAdd() {
    isAdding = true
    labelInput = ''
  }

  async function addSuggestion(label: TaskLabel) {
    await onAdd(label)
  }

  async function addLabelFromInput() {
    const [firstLabel] = visibleAvailableLabels
    if (firstLabel) {
      await addSuggestion(firstLabel)
      labelInput = ''
      return
    }

    if (!canCreateLabel) return
    await onAdd(trimmedLabelInput)
    labelInput = ''
  }

  async function handleRemove(label: TaskLabel) {
    await onRemove(label)
  }
</script>

<section class="flex flex-col gap-2" aria-label="Labels">
  <h3 class="text-xs font-semibold text-base-content/60 m-0">Labels</h3>

  <div class="flex flex-wrap items-center gap-1.5">
    {#each selectedLabels as label (label.id)}
      <button
        type="button"
        class="badge badge-sm badge-outline gap-1"
        aria-label="Remove label {label.name}"
        onclick={() => handleRemove(label)}
      >
        {label.name}<span aria-hidden="true">×</span>
      </button>
    {/each}

    {#if !isAdding}
      <button
        type="button"
        class="badge badge-sm badge-ghost gap-1"
        aria-label="Add label"
        disabled={!projectId}
        onclick={openAdd}
      >
        <span aria-hidden="true">+</span> Add label
      </button>
    {/if}
  </div>

  {#if isAdding}
    <div class="flex flex-col gap-2">
      <input
        class="input input-bordered input-xs"
        aria-label="Search labels"
        placeholder="Search or create labels"
        bind:value={labelInput}
        disabled={!projectId}
        onkeydown={(event: KeyboardEvent) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void addLabelFromInput()
          }
        }}
      />

      {#if visibleAvailableLabels.length > 0}
        <div class="flex flex-col gap-1" aria-label="Suggestions">
          <span class="text-xs font-semibold text-base-content/60">Suggestions</span>
          <div class="flex flex-wrap gap-1.5">
            {#each visibleAvailableLabels as label (label.id)}
              <button
                type="button"
                class="badge badge-sm badge-ghost gap-1"
                aria-label="Add label {label.name}"
                onclick={() => addSuggestion(label)}
              >
                <span aria-hidden="true">+</span> {label.name}
              </button>
            {/each}
          </div>
        </div>
      {:else if canCreateLabel}
        <div class="flex flex-col gap-1" aria-label="Create label">
          <button
            type="button"
            class="badge badge-sm badge-ghost gap-1 self-start"
            aria-label="Create label {trimmedLabelInput}"
            onclick={() => addLabelFromInput()}
          >
            <span aria-hidden="true">+</span> Create {trimmedLabelInput}
          </button>
        </div>
      {:else}
        <p class="text-xs text-base-content/60 m-0">No matching project labels.</p>
      {/if}
    </div>
  {/if}
</section>
