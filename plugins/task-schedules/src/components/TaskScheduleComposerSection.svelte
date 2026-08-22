<script lang="ts">
  import { CheckCircle2, Clock3, X } from '@lucide/svelte'
  import Checkbox from '@openforge-app/plugin-sdk/ui/Checkbox.svelte'
  import type { SchedulePreset, TaskScheduleMode } from '../lib/types'
  import type { ScheduleDraft, ScheduleFieldErrors } from '../lib/viewTypes'

  interface Props {
    draft: ScheduleDraft
    fieldErrors: ScheduleFieldErrors
    timeOptions: string[]
    dayOfWeekOptions: { value: number; label: string }[]
    composerTitle: string
    enabledToggleLabel: string
    saving: boolean
    cronHelpText: string
    titleFocusRequest: number
    errorFocusRequest: number
    onDraftChange: (draft: ScheduleDraft) => void
    onFieldErrorsChange: (fieldErrors: ScheduleFieldErrors) => void
    onValidateDraft: () => void
    onSaveSchedule: () => void
    onClose: () => void
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
    errorFocusRequest,
    onDraftChange,
    onFieldErrorsChange,
    onValidateDraft,
    onSaveSchedule,
    onClose,
  }: Props = $props()

  let titleInput = $state<HTMLInputElement | null>(null)
  let cronInput = $state<HTMLInputElement | null>(null)
  let runAtInput = $state<HTMLInputElement | null>(null)
  let previousFocusRequest = $state(0)
  let previousErrorFocusRequest = $state(0)

  $effect(() => {
    if (titleFocusRequest === previousFocusRequest) return
    previousFocusRequest = titleFocusRequest
    titleInput?.focus()
  })

  $effect(() => {
    if (errorFocusRequest === previousErrorFocusRequest) return
    previousErrorFocusRequest = errorFocusRequest
    if (fieldErrors.runAt) runAtInput?.focus()
    else cronInput?.focus()
  })

  function changeKind(kind: ScheduleDraft['kind']): void {
    onDraftChange({ ...draft, kind })
    onFieldErrorsChange({ cron: null, runAt: null })
  }
</script>

<aside class="flex h-full min-h-0 flex-col border-l border-base-300 bg-base-100" aria-label="Schedule form">
  <header class="flex min-h-16 items-start justify-between gap-3 border-b border-base-300 px-5 py-4">
    <div>
      <h2 class="text-lg font-semibold">{composerTitle}</h2>
      <p class="mt-1 text-xs text-secondary">Create a Task once or on a recurring cadence.</p>
    </div>
    <button class="btn btn-ghost btn-sm btn-square min-h-10 min-w-10" type="button" aria-label="Close schedule form" disabled={saving} onclick={onClose}>
      <X class="size-4" aria-hidden="true" />
    </button>
  </header>

  <form class="flex min-h-0 flex-1 flex-col" onsubmit={(event) => { event.preventDefault(); onSaveSchedule() }}>
    <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
      <label class="form-control flex w-full flex-col gap-1.5">
        <span class="text-sm font-medium">Title <span class="text-error" aria-hidden="true">*</span></span>
        <input bind:this={titleInput} class="input input-bordered min-h-10 w-full" value={draft.title} oninput={(event) => onDraftChange({ ...draft, title: event.currentTarget.value })} placeholder="Update dependencies" required />
      </label>

      <label class="form-control flex w-full flex-col gap-1.5">
        <span class="text-sm font-medium">Prompt <span class="text-error" aria-hidden="true">*</span></span>
        <textarea class="textarea textarea-bordered min-h-36 w-full resize-y leading-relaxed" value={draft.prompt} oninput={(event) => onDraftChange({ ...draft, prompt: event.currentTarget.value })} placeholder="Describe the task created on each run" required></textarea>
        <span class="text-xs text-secondary">This becomes the task prompt for every scheduled run.</span>
      </label>

      <fieldset class="space-y-2">
        <legend class="text-sm font-medium">Schedule type</legend>
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="flex min-h-12 items-start gap-3 rounded-box border border-base-300 px-3 py-2.5 text-sm">
            <input class="radio radio-primary radio-sm mt-0.5" type="radio" name="schedule-kind" value="recurring" checked={draft.kind === 'recurring'} disabled={draft.id !== null} onclick={() => changeKind('recurring')} />
            <span><span class="block font-medium">Recurring</span><span class="block text-xs text-secondary">Run on a repeating cadence</span></span>
          </label>
          <label class="flex min-h-12 items-start gap-3 rounded-box border border-base-300 px-3 py-2.5 text-sm">
            <input class="radio radio-primary radio-sm mt-0.5" type="radio" name="schedule-kind" value="once" checked={draft.kind === 'once'} disabled={draft.id !== null} onclick={() => changeKind('once')} />
            <span><span class="block font-medium">One time</span><span class="block text-xs text-secondary">Run once at a future date</span></span>
          </label>
        </div>
        {#if draft.id}<p class="text-xs text-secondary">Schedule type can’t be changed after creation.</p>{/if}
      </fieldset>

      <fieldset class="space-y-3">
        <legend class="text-sm font-semibold">Cadence</legend>
        {#if draft.kind === 'once'}
          <div class="form-control flex w-full flex-col gap-1.5">
            <label for="schedule-run-at" class="text-sm font-medium">Run on <span class="text-error" aria-hidden="true">*</span></label>
            <input
              bind:this={runAtInput}
              id="schedule-run-at"
              type="datetime-local"
              class="input input-bordered min-h-10 w-full {fieldErrors.runAt ? 'input-error' : ''}"
              value={draft.runAt}
              oninput={(event) => {
                onDraftChange({ ...draft, runAt: event.currentTarget.value })
                onFieldErrorsChange({ ...fieldErrors, runAt: null })
              }}
              aria-describedby="run-at-help"
              aria-invalid={fieldErrors.runAt ? 'true' : 'false'}
              onblur={() => { if (draft.runAt) onValidateDraft() }}
              required
            />
            <span id="run-at-help" class="text-xs {fieldErrors.runAt ? 'text-error' : 'text-secondary'}" role={fieldErrors.runAt ? 'alert' : undefined}>
              {fieldErrors.runAt ?? 'This Task Schedule runs once at the selected local date and time.'}
            </span>
          </div>
        {:else}
          {#if draft.advancedCron}
          <div class="form-control flex w-full flex-col gap-1.5">
            <label for="cron-expression" class="text-sm font-medium">Cron expression</label>
            <input
              bind:this={cronInput}
              id="cron-expression"
              class="input input-bordered min-h-10 w-full font-mono {fieldErrors.cron ? 'input-error' : ''}"
              value={draft.cron}
              oninput={(event) => { onDraftChange({ ...draft, cron: event.currentTarget.value }); onFieldErrorsChange({ ...fieldErrors, cron: null }) }}
              placeholder="0 9 * * 1-5"
              aria-describedby="cron-help"
              aria-invalid={fieldErrors.cron ? 'true' : 'false'}
              onblur={() => { if (draft.advancedCron && draft.cron.trim()) onValidateDraft() }}
            />
            <span id="cron-help" class="text-xs {fieldErrors.cron ? 'text-error' : 'text-secondary'}" role={fieldErrors.cron ? 'alert' : undefined}>{fieldErrors.cron ?? cronHelpText}</span>
          </div>
        {:else}
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="form-control flex w-full flex-col gap-1.5">
              <span class="text-sm font-medium">Frequency</span>
              <select class="select select-bordered min-h-10 w-full" value={draft.preset} onchange={(event) => onDraftChange({ ...draft, preset: event.currentTarget.value as SchedulePreset })}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>

            <label class="form-control flex w-full flex-col gap-1.5">
              <span class="text-sm font-medium">Run at</span>
              <select class="select select-bordered min-h-10 w-full" value={draft.timeOfDay} onchange={(event) => onDraftChange({ ...draft, timeOfDay: event.currentTarget.value })}>
                {#each timeOptions as time}<option value={time}>{time}</option>{/each}
              </select>
            </label>

            {#if draft.preset === 'weekly'}
              <label class="form-control flex w-full flex-col gap-1.5">
                <span class="text-sm font-medium">Day</span>
                <select class="select select-bordered min-h-10 w-full" value={draft.dayOfWeek} onchange={(event) => onDraftChange({ ...draft, dayOfWeek: Number(event.currentTarget.value) })}>
                  {#each dayOfWeekOptions as day}<option value={day.value}>{day.label}</option>{/each}
                </select>
              </label>
            {/if}
          </div>
        {/if}

        <label class="flex min-h-10 items-center gap-3 rounded-box border border-base-300 px-3 text-sm">
          <Checkbox checked={draft.advancedCron} onchange={(event) => { onDraftChange({ ...draft, advancedCron: event.currentTarget.checked }); onFieldErrorsChange({ ...fieldErrors, cron: null }) }} />
          <span>Use a custom cron expression</span>
        </label>
        {/if}
        <p class="flex items-center gap-1.5 text-xs text-secondary"><Clock3 class="size-3.5" aria-hidden="true" /> Times use {Intl.DateTimeFormat().resolvedOptions().timeZone || 'your local timezone'}.</p>
      </fieldset>

      <div class="form-control flex w-full flex-col gap-1.5">
        <label for="schedule-mode" class="text-sm font-medium">Mode</label>
        <select id="schedule-mode" class="select select-bordered min-h-10 w-full" value={draft.mode} aria-describedby="schedule-mode-help" onchange={(event) => onDraftChange({ ...draft, mode: event.currentTarget.value as TaskScheduleMode })}>
          <option value="create-and-start">Create + start</option>
          <option value="create-only">Create only</option>
        </select>
        <span id="schedule-mode-help" class="text-xs leading-5 text-secondary">
          {draft.mode === 'create-and-start'
            ? 'Creates a task and starts implementation when the previous scheduled task is closed.'
            : 'Creates a task in the backlog for a manual start.'}
        </span>
      </div>

      <label class="flex min-h-11 items-center justify-between gap-3 rounded-box border border-base-300 px-3 text-sm">
        <span>
          <span class="block font-medium">{enabledToggleLabel}</span>
          <span class="block text-xs text-secondary">Paused schedules can still be run manually.</span>
        </span>
        <input class="toggle toggle-primary" type="checkbox" checked={draft.enabled} onchange={(event) => onDraftChange({ ...draft, enabled: event.currentTarget.checked })} />
      </label>
    </div>

    <footer class="flex shrink-0 items-center justify-end gap-2 border-t border-base-300 p-4">
      <button class="btn min-h-10" type="button" disabled={saving} onclick={onClose}>Cancel</button>
      <button class="btn btn-primary min-h-10" type="submit" disabled={saving}>
        {#if saving}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<CheckCircle2 class="size-4" aria-hidden="true" />{/if}
        {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create schedule'}
      </button>
    </footer>
  </form>
</aside>
