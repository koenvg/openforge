<script lang="ts">
  import { CheckCircle2, Clock3, X } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Checkbox from '@openforge-app/plugin-sdk/ui/Checkbox.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import Select from '@openforge-app/plugin-sdk/ui/Select.svelte'
  import Switch from '@openforge-app/plugin-sdk/ui/Switch.svelte'
  import Textarea from '@openforge-app/plugin-sdk/ui/Textarea.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  import type { SchedulePreset, TaskScheduleMode } from '../lib/types'
  import { emptyScheduleDraftTiming, emptyScheduleFieldErrors } from '../lib/taskSchedulesViewModel'
  import type {
    OneOffScheduleDraftTiming,
    RecurringScheduleDraftTiming,
    ScheduleDraft,
    ScheduleFieldErrors,
  } from '../lib/viewTypes'

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

  const titleInputId = 'schedule-title'
  const cronInputId = 'cron-expression'
  const runAtInputId = 'schedule-run-at'
  const frequencyOptions = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
  ]
  const modeOptions = [
    { value: 'create-and-start', label: 'Create + start' },
    { value: 'create-only', label: 'Create only' },
  ]
  let timeSelectOptions = $derived(timeOptions.map((time) => ({ value: time, label: time })))
  let daySelectOptions = $derived(dayOfWeekOptions.map((day) => ({ value: String(day.value), label: day.label })))
  let recurringTiming = $state<RecurringScheduleDraftTiming>(emptyScheduleDraftTiming())
  let oneOffTiming = $state<OneOffScheduleDraftTiming>(emptyScheduleDraftTiming('once'))
  let previousFocusRequest = $state(0)
  let previousErrorFocusRequest = $state(0)

  function focusField(id: string): void {
    document.getElementById(id)?.focus()
  }

  $effect(() => {
    if (titleFocusRequest === previousFocusRequest) return
    previousFocusRequest = titleFocusRequest
    focusField(titleInputId)
  })

  $effect(() => {
    if (errorFocusRequest === previousErrorFocusRequest) return
    previousErrorFocusRequest = errorFocusRequest
    focusField(fieldErrors.runAt ? runAtInputId : cronInputId)
  })

  $effect(() => {
    const { timing } = draft
    if (timing.type === 'recurring') recurringTiming = timing
    else oneOffTiming = timing
  })

  function changeKind(kind: ScheduleDraft['timing']['type']): void {
    onDraftChange({ ...draft, timing: kind === 'recurring' ? recurringTiming : oneOffTiming })
    onFieldErrorsChange(emptyScheduleFieldErrors())
  }
</script>

<aside class="schedule-composer-shell" aria-label="Task Schedule form">
  <header class="schedule-composer-header">
    <div>
      <h2>{composerTitle}</h2>
      <p>Create a Task once or on a recurring cadence.</p>
    </div>
    <IconButton label="Close Task Schedule form" type="button" disabled={saving} onClick={onClose}>
      <X class="size-4" aria-hidden="true" />
    </IconButton>
  </header>

  <form id="task-schedule-form" class="schedule-composer-form" onsubmit={(event) => { event.preventDefault(); onSaveSchedule() }}>
    <Panel class="schedule-composer-body">
    <div class="schedule-composer-content">
      <TextField
        id={titleInputId}
        label="Title (required)"
        value={draft.title}
        onValueChange={(title) => onDraftChange({ ...draft, title })}
        placeholder="Update dependencies"
        required
      />

      <Textarea
        label="Prompt (required)"
        value={draft.prompt}
        onValueChange={(prompt) => onDraftChange({ ...draft, prompt })}
        helperText="This becomes the Task prompt for every scheduled run."
        placeholder="Describe the Task created on each run"
        style="min-height: calc(var(--of-control-height) * 4)"
        required
      />

      <fieldset class="schedule-fieldset">
        <legend>Task Schedule type</legend>
        <div class="schedule-type-grid">
          <label class="schedule-type-option">
            <input type="radio" name="schedule-kind" value="recurring" checked={draft.timing.type === 'recurring'} disabled={draft.id !== null} onclick={() => changeKind('recurring')} />
            <span><span class="schedule-option-title">Recurring</span><span class="schedule-help">Run on a repeating cadence</span></span>
          </label>
          <label class="schedule-type-option">
            <input type="radio" name="schedule-kind" value="once" checked={draft.timing.type === 'once'} disabled={draft.id !== null} onclick={() => changeKind('once')} />
            <span><span class="schedule-option-title">One time</span><span class="schedule-help">Run once at a future date</span></span>
          </label>
        </div>
        {#if draft.id}<p class="schedule-help">Task Schedule type can’t be changed after creation.</p>{/if}
      </fieldset>

      <fieldset class="schedule-fieldset cadence-fieldset">
        <legend>Cadence</legend>
        {#if draft.timing.type === 'once'}
          <TextField
            id={runAtInputId}
            label="Run on (required)"
            type="datetime-local"
            value={draft.timing.runAt}
            onValueChange={(runAt) => {
              onDraftChange({ ...draft, timing: { ...draft.timing, runAt } })
              onFieldErrorsChange({ ...fieldErrors, runAt: null })
            }}
            helperText={fieldErrors.runAt ? undefined : 'This Task Schedule runs once at the selected local date and time.'}
            error={fieldErrors.runAt}
            onblur={() => { if (draft.timing.type === 'once' && draft.timing.runAt) onValidateDraft() }}
            required
          />
        {:else}
          {#if draft.timing.advancedCron}
          <TextField
            id={cronInputId}
            label="Cron expression"
            value={draft.timing.cron}
            onValueChange={(cron) => {
              onDraftChange({ ...draft, timing: { ...draft.timing, cron } })
              onFieldErrorsChange({ ...fieldErrors, cron: null })
            }}
            placeholder="0 9 * * 1-5"
            helperText={fieldErrors.cron ? undefined : cronHelpText}
            error={fieldErrors.cron}
            style="font-family: var(--of-font-mono)"
            onblur={() => { if (draft.timing.type === 'recurring' && draft.timing.advancedCron && draft.timing.cron.trim()) onValidateDraft() }}
          />
        {:else}
          <div class="schedule-timing-grid">
            <Select
              label="Frequency"
              options={frequencyOptions}
              value={draft.timing.preset}
              onValueChange={(preset) => onDraftChange({ ...draft, timing: { ...draft.timing, preset: preset as SchedulePreset } })}
            />

            <Select
              label="Run at"
              options={timeSelectOptions}
              value={draft.timing.timeOfDay}
              onValueChange={(timeOfDay) => onDraftChange({ ...draft, timing: { ...draft.timing, timeOfDay } })}
            />

            {#if draft.timing.preset === 'weekly'}
              <Select
                label="Day"
                options={daySelectOptions}
                value={String(draft.timing.dayOfWeek)}
                onValueChange={(dayOfWeek) => onDraftChange({ ...draft, timing: { ...draft.timing, dayOfWeek: Number(dayOfWeek) } })}
              />
            {/if}
          </div>
        {/if}

        <label class="schedule-checkbox-option">
          <Checkbox
            checked={draft.timing.advancedCron}
            onCheckedChange={(advancedCron) => {
              onDraftChange({ ...draft, timing: { ...draft.timing, advancedCron } })
              onFieldErrorsChange({ ...fieldErrors, cron: null })
            }}
          />
          <span>Use a custom cron expression</span>
        </label>
        {/if}
        <p class="schedule-timezone"><Clock3 class="size-3.5" aria-hidden="true" /> Times use {Intl.DateTimeFormat().resolvedOptions().timeZone || 'your local timezone'}.</p>
      </fieldset>

      <Select
        id="schedule-mode"
        label="Mode"
        options={modeOptions}
        value={draft.mode}
        onValueChange={(mode) => onDraftChange({ ...draft, mode: mode as TaskScheduleMode })}
        helperText={draft.mode === 'create-and-start'
          ? 'Creates a Task and starts implementation when the previous scheduled Task is closed.'
          : 'Creates a Task in the backlog for a manual start.'}
      />

      <div class="schedule-enabled-control">
        <Switch
          label={enabledToggleLabel}
          checked={draft.enabled}
          onCheckedChange={(enabled) => onDraftChange({ ...draft, enabled })}
        />
        <span class="schedule-help">Paused Task Schedules can still be run manually.</span>
      </div>
    </div>
    </Panel>
  </form>

  <footer class="schedule-composer-footer">
    <Button variant="secondary" type="button" disabled={saving} onClick={onClose}>Cancel</Button>
    <Button form="task-schedule-form" type="submit" disabled={saving}>
      {#if saving}<span class="schedule-spinner" aria-hidden="true"></span>{:else}<CheckCircle2 class="size-4" aria-hidden="true" />{/if}
      {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create Task Schedule'}
    </Button>
  </footer>
</aside>

<style>
  .schedule-composer-shell {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    border-left: var(--of-border-width) solid var(--of-border);
    background: var(--of-surface);
    color: var(--of-text);
    font-family: var(--of-font-sans);
  }

  :global(.schedule-composer-body) {
    height: 100%;
    overflow-y: auto;
  }

  .schedule-composer-header {
    display: flex;
    flex: none;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--of-space3);
    min-height: var(--of-control-height-touch);
    padding: var(--of-space4) var(--of-space5);
    border-bottom: var(--of-border-width) solid var(--of-border);
  }

  .schedule-composer-header h2 {
    margin: 0;
    color: var(--of-text);
    font-size: var(--of-text-lg);
    font-weight: var(--of-weight-semibold);
    line-height: var(--of-line-height-lg);
  }

  .schedule-composer-header p,
  .schedule-help,
  .schedule-timezone {
    color: var(--of-text-muted);
    font-size: var(--of-text-xs);
    line-height: var(--of-line-height-xs);
  }

  .schedule-composer-header p {
    margin: var(--of-space1) 0 0;
  }

  .schedule-composer-form {
    min-height: 0;
    flex: 1;
  }

  .schedule-composer-content,
  .schedule-fieldset,
  .schedule-enabled-control {
    display: grid;
  }

  .schedule-composer-content {
    gap: var(--of-space5);
  }


  .schedule-fieldset {
    gap: var(--of-space2);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .cadence-fieldset {
    gap: var(--of-space3);
  }

  .schedule-fieldset legend {
    margin-bottom: var(--of-space2);
    color: var(--of-text);
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
    line-height: var(--of-line-height-sm);
  }

  .schedule-type-grid,
  .schedule-timing-grid {
    display: grid;
    gap: var(--of-space2);
  }

  .schedule-type-option,
  .schedule-checkbox-option {
    display: flex;
    align-items: flex-start;
    gap: var(--of-space3);
    min-height: var(--of-control-height-touch);
    padding: var(--of-space2) var(--of-space3);
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-container);
    background: var(--of-surface);
    color: var(--of-text);
    font-size: var(--of-text-sm);
    line-height: var(--of-line-height-sm);
  }

  .schedule-type-option input {
    margin-top: var(--of-space1);
    accent-color: var(--of-accent);
  }

  .schedule-type-option input:focus-visible {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  .schedule-type-option:has(input:disabled) {
    color: var(--of-control-text-disabled);
  }

  .schedule-option-title,
  .schedule-help {
    display: block;
  }

  .schedule-option-title {
    font-weight: var(--of-weight-medium);
  }

  .schedule-checkbox-option {
    align-items: center;
  }

  .schedule-timezone {
    display: flex;
    align-items: center;
    gap: var(--of-space2);
    margin: 0;
  }

  .schedule-enabled-control {
    gap: var(--of-space2);
    padding: var(--of-space3);
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-container);
    background: var(--of-surface);
  }

  .schedule-composer-footer {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: flex-end;
    gap: var(--of-space2);
    padding: var(--of-space4);
    border-top: var(--of-border-width) solid var(--of-border);
  }

  .schedule-spinner {
    box-sizing: border-box;
    width: var(--of-space4);
    height: var(--of-space4);
    border: var(--of-border-width) solid currentColor;
    border-right-color: transparent;
    border-radius: var(--of-radius-round);
    animation: schedule-spin var(--of-duration-deliberate) linear infinite;
  }

  @media (min-width: 40rem) {
    .schedule-type-grid,
    .schedule-timing-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .schedule-spinner {
      animation-duration: 1ms;
    }
  }

  @keyframes schedule-spin {
    to { transform: rotate(360deg); }
  }
</style>
