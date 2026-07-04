<script lang="ts">
  import { tick } from 'svelte'
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge/plugin-sdk/frontend'
  import { dayOfWeekFromCron, describeCronExpression, timeOfDayFromCron, validateFiveFieldCron } from '../lib/cron'
  import type { ScheduledFireOutcome, SchedulePreset, TaskSchedule, TaskScheduleDraft, TaskScheduleMode } from '../lib/types'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectId: string | null
    projectName?: string
  }

  const LIST_SCHEDULES_METHOD = 'listSchedules'
  const SAVE_SCHEDULE_METHOD = 'saveSchedule'
  const DELETE_SCHEDULE_METHOD = 'deleteSchedule'
  const RUN_NOW_METHOD = 'runNow'
  const CRON_HELP_TEXT = 'Use five fields: minute hour day-of-month month day-of-week.'

  let { api, context: _context, projectId, projectName = '' }: Props = $props()

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

  const timeOptions = Array.from({ length: 24 * 4 }, (_, index) => {
    const hour = Math.floor(index / 4)
    const minute = (index % 4) * 15
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
  })

  const dayOfWeekOptions = [
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
    { value: 0, label: 'Sunday' },
  ]

  const emptyDraft = (): Draft => ({
    id: null,
    title: '',
    prompt: '',
    preset: 'daily',
    cron: '0 9 * * *',
    timeOfDay: '09:00',
    dayOfWeek: 1,
    advancedCron: false,
    mode: 'create-and-start',
    enabled: true,
  })

  const emptyFieldErrors = (): FieldErrors => ({ cron: null })

  let schedules = $state<TaskSchedule[]>([])
  let draft = $state<Draft>(emptyDraft())
  let fieldErrors = $state<FieldErrors>(emptyFieldErrors())
  let loading = $state(false)
  let saving = $state(false)
  let deletingScheduleId = $state<string | null>(null)
  let runningScheduleId = $state<string | null>(null)
  let confirmingDeleteId = $state<string | null>(null)
  let error = $state<string | null>(null)
  let previousProjectId: string | null = null
  let loadRequestId = 0
  let titleInput = $state<HTMLInputElement | null>(null)
  let editAnnouncement = $state('')

  let sortedSchedules = $derived([...schedules].sort((a, b) => a.nextFireAt - b.nextFireAt || a.title.localeCompare(b.title)))
  let composerTitle = $derived(draft.id ? 'Edit Task Schedule' : 'New Task Schedule')
  let enabledToggleLabel = $derived(draft.id ? (draft.enabled ? 'Schedule enabled' : 'Schedule disabled') : 'Enabled by default')

  $effect(() => {
    if (projectId === previousProjectId) return
    previousProjectId = projectId
    loadRequestId += 1
    draft = emptyDraft()
    fieldErrors = emptyFieldErrors()
    confirmingDeleteId = null
    schedules = []
    if (projectId) {
      void loadSchedules(projectId)
    }
  })

  function isCurrentLoad(activeProjectId: string, requestId: number): boolean {
    return projectId === activeProjectId && requestId === loadRequestId
  }

  async function loadSchedules(activeProjectId: string) {
    const requestId = ++loadRequestId
    loading = true
    error = null
    try {
      await api.backend.whenReady()
      const loadedSchedules = await api.backend.invoke<TaskSchedule[]>(LIST_SCHEDULES_METHOD, { projectId: activeProjectId })
      if (!isCurrentLoad(activeProjectId, requestId)) return
      schedules = loadedSchedules
    } catch (cause) {
      if (!isCurrentLoad(activeProjectId, requestId)) return
      error = messageForAsyncError(cause)
    } finally {
      if (isCurrentLoad(activeProjectId, requestId)) {
        loading = false
      }
    }
  }

  async function saveSchedule() {
    if (!projectId) return
    error = null
    fieldErrors = emptyFieldErrors()
    if (!validateDraft()) return

    saving = true
    try {
      const saved = await api.backend.invoke<TaskSchedule>(SAVE_SCHEDULE_METHOD, {
        projectId,
        schedule: draftToPayload(draft),
      })
      schedules = schedules.some((schedule) => schedule.id === saved.id)
        ? schedules.map((schedule) => schedule.id === saved.id ? saved : schedule)
        : [...schedules, saved]
      draft = emptyDraft()
      fieldErrors = emptyFieldErrors()
    } catch (cause) {
      handleSaveError(cause)
    } finally {
      saving = false
    }
  }

  async function editSchedule(schedule: TaskSchedule) {
    draft = {
      id: schedule.id,
      title: schedule.title,
      prompt: schedule.prompt,
      preset: schedule.preset === 'custom' ? 'daily' : schedule.preset,
      cron: schedule.cron,
      timeOfDay: timeOfDayFromCron(schedule.cron),
      dayOfWeek: schedule.preset === 'weekly' ? dayOfWeekFromCron(schedule.cron) : 1,
      advancedCron: schedule.preset === 'custom',
      mode: schedule.mode,
      enabled: schedule.enabled,
    }
    fieldErrors = emptyFieldErrors()
    error = null
    editAnnouncement = `Editing ${schedule.title}`
    await tick()
    titleInput?.focus()
  }

  async function deleteSchedule(schedule: TaskSchedule) {
    if (!projectId) return
    error = null
    deletingScheduleId = schedule.id
    try {
      await api.backend.invoke(DELETE_SCHEDULE_METHOD, { projectId, scheduleId: schedule.id })
      schedules = schedules.filter((candidate) => candidate.id !== schedule.id)
      confirmingDeleteId = null
      if (draft.id === schedule.id) draft = emptyDraft()
    } catch (cause) {
      error = messageForAsyncError(cause)
    } finally {
      deletingScheduleId = null
    }
  }


  async function runNow(scheduleId: string) {
    if (!projectId) return
    error = null
    runningScheduleId = scheduleId
    try {
      await api.backend.invoke<ScheduledFireOutcome>(RUN_NOW_METHOD, { projectId, scheduleId })
      await loadSchedules(projectId)
    } catch (cause) {
      error = messageForAsyncError(cause)
    } finally {
      runningScheduleId = null
    }
  }

  function validateDraft(): boolean {
    if (!draft.advancedCron) return true

    const validation = validateFiveFieldCron(draft.cron)
    if (validation.valid) return true

    fieldErrors = { ...fieldErrors, cron: CRON_HELP_TEXT }
    error = 'Fix the highlighted schedule fields and try again.'
    return false
  }

  function handleSaveError(cause: unknown): void {
    if (isCronError(cause)) {
      fieldErrors = { ...fieldErrors, cron: CRON_HELP_TEXT }
      error = 'Fix the highlighted schedule fields and try again.'
      return
    }

    error = messageForAsyncError(cause)
  }

  function draftToPayload(currentDraft: Draft): TaskScheduleDraft {
    return {
      id: currentDraft.id,
      title: currentDraft.title,
      prompt: currentDraft.prompt,
      preset: currentDraft.advancedCron ? 'custom' : currentDraft.preset,
      cron: currentDraft.advancedCron ? currentDraft.cron : null,
      timeOfDay: currentDraft.advancedCron ? null : currentDraft.timeOfDay,
      dayOfWeek: !currentDraft.advancedCron && currentDraft.preset === 'weekly' ? currentDraft.dayOfWeek : null,
      mode: currentDraft.mode,
      enabled: currentDraft.enabled,
    }
  }


  function messageForAsyncError(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
  }

  function isCronError(cause: unknown): boolean {
    const message = messageForAsyncError(cause).toLowerCase()
    return message.includes('cron') || message.includes('schedule preset') || message.includes('field')
  }

  function runNowDescription(schedule: TaskSchedule): string {
    if (schedule.mode === 'create-only') {
      return 'Creates a scheduled board Task immediately without starting implementation.'
    }

    return 'Creates a scheduled board Task immediately and starts implementation if no previous scheduled Task is still open.'
  }

  function schedulePresetLabel(schedule: TaskSchedule): string {
    return schedule.preset === 'custom' ? schedule.cron : schedule.preset
  }

  function scheduleHumanDescription(schedule: TaskSchedule): string | null {
    return schedule.preset === 'custom' ? describeCronExpression(schedule.cron) : null
  }

  function formatDate(value: number | null): string {
    if (value === null) return 'Never'
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  }
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
  <div class="flex items-center justify-between border-b border-base-300 bg-base-200 px-4 py-2 shrink-0">
    <div>
      <h2 class="text-sm font-semibold text-base-content">{projectName || 'Project'} — Task Schedules</h2>
      <p class="text-xs text-base-content/60">Create recurring project tasks and optional implementation runs.</p>
    </div>
    {#if projectId}
      <button class="btn btn-sm" type="button" disabled={loading} onclick={() => loadSchedules(projectId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
    {/if}
  </div>

  <div role="status" aria-live="polite" class="sr-only">{editAnnouncement}</div>

  <div class="flex-1 overflow-auto px-3 py-6 sm:px-4">
  {#if !projectId}
    <div class="alert alert-info">Select a project to manage Task Schedules.</div>
  {:else}
    {#if error}
      <div class="alert alert-error mb-4" role="alert" aria-live="assertive">{error}</div>
    {/if}


    <div class="grid items-start gap-y-6 gap-x-4 md:grid-cols-[minmax(18rem,1fr)_minmax(22rem,28rem)]">
      <section class="min-w-0 space-y-3" aria-label="Task schedules list">
        {#if loading && schedules.length === 0}
          <div class="loading loading-spinner loading-md" aria-label="Loading Task Schedules"></div>
        {:else if sortedSchedules.length === 0}
          <div class="rounded-box border border-dashed border-base-300 bg-base-100 px-4 py-6 text-sm text-base-content/70">
            <h2 class="text-base font-semibold text-base-content">No Task Schedules yet</h2>
            <p class="mt-1">Create the first project-scoped Task Schedule with the composer.</p>
          </div>
        {:else}
          {#each sortedSchedules as schedule (schedule.id)}
            <article class="rounded-box border border-base-300 bg-base-100 px-3 py-4 shadow-sm">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 class="text-lg font-semibold">{schedule.title}</h2>
                  <p class="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-base-content/70">{schedule.prompt}</p>
                </div>
                <div class="badge {schedule.enabled ? 'badge-success' : 'badge-ghost'}">
                  {schedule.enabled ? 'Enabled' : 'Disabled'}
                </div>
              </div>

              <dl class="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt class="text-base-content/60">Schedule Preset</dt>
                  <dd class="font-medium">{schedulePresetLabel(schedule)}</dd>
                  {#if scheduleHumanDescription(schedule)}
                    <dd class="text-xs text-base-content/60">{scheduleHumanDescription(schedule)}</dd>
                  {/if}
                </div>
                <div>
                  <dt class="text-base-content/60">Mode</dt>
                  <dd class="font-medium">{schedule.mode === 'create-and-start' ? 'Create + start' : 'Create only'}</dd>
                </div>
                <div>
                  <dt class="text-base-content/60">Next Scheduled Fire</dt>
                  <dd class="font-medium">{formatDate(schedule.nextFireAt)}</dd>
                </div>
                <div>
                  <dt class="text-base-content/60">Last scheduled Task</dt>
                  <dd class="font-medium">{schedule.lastTaskId ?? 'None'}</dd>
                </div>
              </dl>

              <p class="mt-3 text-xs leading-relaxed text-base-content/60">{runNowDescription(schedule)}</p>

              {#if schedule.history.length > 0}
                <div class="mt-4 rounded-box bg-base-200 p-3">
                  <h3 class="text-sm font-semibold">Recent Scheduled Fires</h3>
                  <ul class="mt-2 space-y-1 text-xs text-base-content/70">
                    {#each [...schedule.history].reverse() as outcome (outcome.id)}
                      <li>{formatDate(outcome.firedAt)} · {outcome.status} · {outcome.message}</li>
                    {/each}
                  </ul>
                </div>
              {/if}

              <div class="mt-4 flex flex-wrap gap-2">
                <button class="btn btn-primary btn-sm" type="button" disabled={runningScheduleId === schedule.id || deletingScheduleId === schedule.id} onclick={() => runNow(schedule.id)}>
                  {runningScheduleId === schedule.id ? 'Running now…' : 'Run now'}
                </button>
                <button class="btn btn-sm" type="button" disabled={runningScheduleId === schedule.id || deletingScheduleId === schedule.id} onclick={() => { void editSchedule(schedule) }}>Edit</button>
                {#if confirmingDeleteId === schedule.id}
                  <span class="inline-flex flex-wrap items-center gap-2 rounded-box bg-base-200 px-2 py-1 text-sm" role="group" aria-label="Confirm delete Task Schedule">
                    <span>Delete this Task Schedule?</span>
                    <button class="btn btn-error btn-xs" type="button" disabled={deletingScheduleId === schedule.id} onclick={() => deleteSchedule(schedule)}>
                      {deletingScheduleId === schedule.id ? 'Deleting…' : 'Confirm delete'}
                    </button>
                    <button class="btn btn-ghost btn-xs" type="button" disabled={deletingScheduleId === schedule.id} onclick={() => { confirmingDeleteId = null }}>Cancel</button>
                  </span>
                {:else}
                  <button class="btn btn-ghost btn-sm" type="button" disabled={runningScheduleId === schedule.id || deletingScheduleId === schedule.id} onclick={() => { confirmingDeleteId = schedule.id }}>Delete</button>
                {/if}
              </div>
            </article>
          {/each}
        {/if}
      </section>

      <aside class="rounded-box border border-base-300 bg-base-100 px-4 py-5 shadow-sm md:sticky md:top-4" role="region" aria-label="Task schedule composer">
        <div class="space-y-1">
          <h2 class="text-lg font-semibold">{composerTitle}</h2>
          <p class="text-xs leading-relaxed text-base-content/60">Use a plain prompt and simple cadence. Scheduled Fires create normal board Tasks.</p>
        </div>
        <form class="mt-5 flex flex-col gap-4" onsubmit={(event) => { event.preventDefault(); void saveSchedule() }}>
          <label class="form-control flex w-full flex-col gap-1">
            <span class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Title</span>
            <input bind:this={titleInput} class="input input-bordered w-full" bind:value={draft.title} placeholder="Daily dependency triage" required />
          </label>

          <label class="form-control flex w-full flex-col gap-1">
            <span class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Plain prompt</span>
            <textarea class="textarea textarea-bordered min-h-40 w-full resize-y leading-relaxed" bind:value={draft.prompt} placeholder="Describe the Task to create on each Scheduled Fire" required></textarea>
          </label>

          {#if draft.advancedCron}
            <div class="form-control flex w-full flex-col gap-1">
              <label for="cron-expression" class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Cron expression</label>
              <input
                id="cron-expression"
                class="input input-bordered w-full font-mono {fieldErrors.cron ? 'input-error' : ''}"
                bind:value={draft.cron}
                placeholder="*/30 * * * *"
                aria-describedby="cron-help"
                aria-invalid={fieldErrors.cron ? 'true' : 'false'}
                oninput={() => { fieldErrors = { ...fieldErrors, cron: null } }}
                onblur={() => { if (draft.advancedCron && draft.cron.trim()) validateDraft() }}
              />
              <span id="cron-help" class="text-xs {fieldErrors.cron ? 'text-error' : 'text-base-content/60'}">{fieldErrors.cron ?? CRON_HELP_TEXT}</span>
            </div>
          {:else}
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="form-control flex w-full flex-col gap-1">
                <span class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Interval</span>
                <select class="select select-bordered w-full" bind:value={draft.preset}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>

              <label class="form-control flex w-full flex-col gap-1">
                <span class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Run at</span>
                <select class="select select-bordered w-full" bind:value={draft.timeOfDay}>
                  {#each timeOptions as time}
                    <option value={time}>{time}</option>
                  {/each}
                </select>
              </label>

              {#if draft.preset === 'weekly'}
                <label class="form-control flex w-full flex-col gap-1">
                  <span class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Day</span>
                  <select class="select select-bordered w-full" bind:value={draft.dayOfWeek}>
                    {#each dayOfWeekOptions as day}
                      <option value={day.value}>{day.label}</option>
                    {/each}
                  </select>
                </label>
              {/if}
            </div>
          {/if}

          <label class="flex min-h-11 items-center gap-3 rounded-box bg-base-200/60 px-3 text-sm">
            <input class="checkbox checkbox-primary checkbox-sm" type="checkbox" bind:checked={draft.advancedCron} onchange={() => { fieldErrors = emptyFieldErrors() }} />
            <span>Advanced: use a cron expression</span>
          </label>

          <div class="form-control flex w-full flex-col gap-1">
            <label for="schedule-mode" class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Mode</label>
            <select id="schedule-mode" class="select select-bordered w-full" bind:value={draft.mode} aria-describedby="schedule-mode-help">
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
            <input class="toggle toggle-primary" type="checkbox" bind:checked={draft.enabled} />
            <span>{enabledToggleLabel}</span>
          </label>

          <div class="flex flex-wrap gap-2 pt-1">
            <button class="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Task Schedule'}</button>
            {#if draft.id}
              <button class="btn btn-ghost" type="button" disabled={saving} onclick={() => { draft = emptyDraft(); fieldErrors = emptyFieldErrors() }}>Cancel</button>
            {/if}
          </div>
        </form>
      </aside>
    </div>
  {/if}
  </div>
</div>
