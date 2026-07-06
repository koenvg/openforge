<script lang="ts">
  import type { SchedulePreset, TaskScheduleMode } from '../lib/types'

  type Draft = {
    id: string | null
    title: string
    prompt: string
    preset: SchedulePreset
    cron: string
    timeOfDay: string
    dayOfWeek: number
    advancedCron: boolean
    mode: TaskScheduleMode
    enabled: boolean
  }

  type FieldErrors = {
    cron: string | null
  }

  interface Props {
    draft: Draft
    fieldErrors: FieldErrors
    timeOptions: string[]
    dayOfWeekOptions: { value: number; label: string }[]
    composerTitle: string
    enabledToggleLabel: string
    saving: boolean
    cronHelpText: string
    titleFocusRequest: number
    onDraftChange: (draft: Draft) => void
    onFieldErrorsChange: (fieldErrors: FieldErrors) => void
    onValidateDraft: () => void
    onSaveSchedule: () => void
    onCancelEdit: () => void
  }

  let {
    draft,
    fieldErrors,
    timeOptions,
    dayOfWeekOptions,
    composerTitle,
    enabledToggleLabel,
    saving,
    cronHelpText,
    titleFocusRequest,
    onDraftChange,
    onFieldErrorsChange,
    onValidateDraft,
    onSaveSchedule,
    onCancelEdit,
  }: Props = $props()

  let titleInput = $state<HTMLInputElement | null>(null)
  let previousFocusRequest = $state(0)

  $effect(() => {
    if (titleFocusRequest === previousFocusRequest) return
    previousFocusRequest = titleFocusRequest
    titleInput?.focus()
  })
</script>

<aside class="rounded-box border border-base-300 bg-base-100 px-4 py-5 shadow-sm md:sticky md:top-4" role="region" aria-label="Task schedule composer">
  <div class="space-y-1">
    <h2 class="text-lg font-semibold">{composerTitle}</h2>
    <p class="text-xs leading-relaxed text-base-content/60">Use a plain prompt and simple cadence. Scheduled Fires create normal board Tasks.</p>
  </div>
  <form class="mt-5 flex flex-col gap-4" onsubmit={(event) => { event.preventDefault(); onSaveSchedule() }}>
    <label class="form-control flex w-full flex-col gap-1">
      <span class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Title</span>
      <input bind:this={titleInput} class="input input-bordered w-full" value={draft.title} oninput={(event) => onDraftChange({ ...draft, title: event.currentTarget.value })} placeholder="Daily dependency triage" required />
    </label>

    <label class="form-control flex w-full flex-col gap-1">
      <span class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Plain prompt</span>
      <textarea class="textarea textarea-bordered min-h-40 w-full resize-y leading-relaxed" value={draft.prompt} oninput={(event) => onDraftChange({ ...draft, prompt: event.currentTarget.value })} placeholder="Describe the Task to create on each Scheduled Fire" required></textarea>
    </label>

    {#if draft.advancedCron}
      <div class="form-control flex w-full flex-col gap-1">
        <label for="cron-expression" class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Cron expression</label>
        <input
          id="cron-expression"
          class="input input-bordered w-full font-mono {fieldErrors.cron ? 'input-error' : ''}"
          value={draft.cron}
          oninput={(event) => { onDraftChange({ ...draft, cron: event.currentTarget.value }); onFieldErrorsChange({ ...fieldErrors, cron: null }) }}
          placeholder="*/30 * * * *"
          aria-describedby="cron-help"
          aria-invalid={fieldErrors.cron ? 'true' : 'false'}
          onblur={() => { if (draft.advancedCron && draft.cron.trim()) onValidateDraft() }}
        />
        <span id="cron-help" class="text-xs {fieldErrors.cron ? 'text-error' : 'text-base-content/60'}">{fieldErrors.cron ?? cronHelpText}</span>
      </div>
    {:else}
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="form-control flex w-full flex-col gap-1">
          <span class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Interval</span>
          <select class="select select-bordered w-full" value={draft.preset} onchange={(event) => onDraftChange({ ...draft, preset: event.currentTarget.value as SchedulePreset })}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>

        <label class="form-control flex w-full flex-col gap-1">
          <span class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Run at</span>
          <select class="select select-bordered w-full" value={draft.timeOfDay} onchange={(event) => onDraftChange({ ...draft, timeOfDay: event.currentTarget.value })}>
            {#each timeOptions as time}
              <option value={time}>{time}</option>
            {/each}
          </select>
        </label>

        {#if draft.preset === 'weekly'}
          <label class="form-control flex w-full flex-col gap-1">
            <span class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Day</span>
            <select class="select select-bordered w-full" value={draft.dayOfWeek} onchange={(event) => onDraftChange({ ...draft, dayOfWeek: Number(event.currentTarget.value) })}>
              {#each dayOfWeekOptions as day}
                <option value={day.value}>{day.label}</option>
              {/each}
            </select>
          </label>
        {/if}
      </div>
    {/if}

    <label class="flex min-h-11 items-center gap-3 rounded-box bg-base-200/60 px-3 text-sm">
      <input class="checkbox checkbox-primary checkbox-sm" type="checkbox" checked={draft.advancedCron} onchange={(event) => { onDraftChange({ ...draft, advancedCron: event.currentTarget.checked }); onFieldErrorsChange({ cron: null }) }} />
      <span>Advanced: use a cron expression</span>
    </label>

    <div class="form-control flex w-full flex-col gap-1">
      <label for="schedule-mode" class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Mode</label>
      <select id="schedule-mode" class="select select-bordered w-full" value={draft.mode} aria-describedby="schedule-mode-help" onchange={(event) => onDraftChange({ ...draft, mode: event.currentTarget.value as TaskScheduleMode })}>
        <option value="create-and-start">Create + start</option>
        <option value="create-only">Create only</option>
      </select>
      <span id="schedule-mode-help" class="text-xs text-base-content/60">
        {draft.mode === 'create-and-start'
          ? 'Scheduled Fires create a board Task and start implementation when no previous scheduled Task is still open.'
          : 'Scheduled Fires create a board Task and leave it in the backlog for manual start.'}
      </span>
    </div>

    <label class="flex min-h-11 items-center gap-3 rounded-box bg-base-200/60 px-3 text-sm">
      <input class="toggle toggle-primary" type="checkbox" checked={draft.enabled} onchange={(event) => onDraftChange({ ...draft, enabled: event.currentTarget.checked })} />
      <span>{enabledToggleLabel}</span>
    </label>

    <div class="flex flex-wrap gap-2 pt-1">
      <button class="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Task Schedule'}</button>
      {#if draft.id}
        <button class="btn btn-ghost" type="button" disabled={saving} onclick={onCancelEdit}>Cancel</button>
      {/if}
    </div>
  </form>
</aside>
