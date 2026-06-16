<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge/plugin-sdk/frontend'
  import { dayOfWeekFromCron, timeOfDayFromCron } from '../lib/cron'
  import type { ScheduledFireOutcome, SchedulePreset, TaskSchedule, TaskScheduleMode } from '../lib/types'

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

  let schedules = $state<TaskSchedule[]>([])
  let draft = $state<Draft>(emptyDraft())
  let loading = $state(false)
  let saving = $state(false)
  let error = $state<string | null>(null)
  let previousProjectId: string | null = null

  let sortedSchedules = $derived([...schedules].sort((a, b) => a.nextFireAt - b.nextFireAt || a.title.localeCompare(b.title)))
  let composerTitle = $derived(draft.id ? 'Edit Task Schedule' : 'New Task Schedule')

  $effect(() => {
    if (projectId === previousProjectId) return
    previousProjectId = projectId
    draft = emptyDraft()
    schedules = []
    if (projectId) {
      void loadSchedules(projectId)
    }
  })

  async function loadSchedules(activeProjectId: string) {
    loading = true
    error = null
    try {
      await api.backend.whenReady()
      schedules = await api.backend.invoke<TaskSchedule[]>(LIST_SCHEDULES_METHOD, { projectId: activeProjectId })
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading = false
    }
  }

  async function saveSchedule() {
    if (!projectId) return
    saving = true
    error = null
    try {
      const saved = await api.backend.invoke<TaskSchedule>(SAVE_SCHEDULE_METHOD, {
        projectId,
        schedule: {
          id: draft.id,
          title: draft.title,
          prompt: draft.prompt,
          preset: draft.advancedCron ? 'custom' : draft.preset,
          cron: draft.advancedCron ? draft.cron : null,
          timeOfDay: draft.advancedCron ? null : draft.timeOfDay,
          dayOfWeek: !draft.advancedCron && draft.preset === 'weekly' ? draft.dayOfWeek : null,
          mode: draft.mode,
          enabled: draft.enabled,
        },
      })
      schedules = schedules.some((schedule) => schedule.id === saved.id)
        ? schedules.map((schedule) => schedule.id === saved.id ? saved : schedule)
        : [...schedules, saved]
      draft = emptyDraft()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      saving = false
    }
  }

  function editSchedule(schedule: TaskSchedule) {
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
  }

  async function deleteSchedule(scheduleId: string) {
    if (!projectId) return
    error = null
    try {
      await api.backend.invoke(DELETE_SCHEDULE_METHOD, { projectId, scheduleId })
      schedules = schedules.filter((schedule) => schedule.id !== scheduleId)
      if (draft.id === scheduleId) draft = emptyDraft()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function runNow(scheduleId: string) {
    if (!projectId) return
    error = null
    try {
      await api.backend.invoke<ScheduledFireOutcome>(RUN_NOW_METHOD, { projectId, scheduleId })
      await loadSchedules(projectId)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function formatDate(value: number | null): string {
    if (value === null) return 'Never'
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  }
</script>

<div class="h-full overflow-auto px-3 py-6 sm:px-4">
  <div class="mx-auto max-w-7xl">
  <div class="mb-6 flex items-start justify-between gap-4">
    <div>
      <p class="text-sm uppercase tracking-wide text-base-content/60">{projectName || 'Project'}</p>
      <h1 class="text-2xl font-semibold">Task Schedules</h1>
      <p class="mt-2 max-w-2xl text-sm text-base-content/70">
        Create recurring project Task Schedules that create normal board Tasks and optionally start an Implementation Run.
      </p>
    </div>
    {#if projectId}
      <button class="btn btn-sm" type="button" onclick={() => loadSchedules(projectId)}>Refresh</button>
    {/if}
  </div>

  {#if !projectId}
    <div class="alert alert-info">Select a project to manage Task Schedules.</div>
  {:else}
    {#if error}
      <div class="alert alert-error mb-4">{error}</div>
    {/if}

    <div class="grid items-start gap-y-6 gap-x-4 md:grid-cols-[minmax(18rem,1fr)_minmax(22rem,28rem)]">
      <section class="min-w-0 space-y-3">
        {#if loading}
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
                  <dd class="font-medium">{schedule.preset === 'custom' ? schedule.cron : schedule.preset}</dd>
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
                <button class="btn btn-primary btn-sm" type="button" onclick={() => runNow(schedule.id)}>Run now</button>
                <button class="btn btn-sm" type="button" onclick={() => editSchedule(schedule)}>Edit</button>
                <button class="btn btn-ghost btn-sm" type="button" onclick={() => deleteSchedule(schedule.id)}>Delete</button>
              </div>
            </article>
          {/each}
        {/if}
      </section>

      <aside class="rounded-box border border-base-300 bg-base-100 px-4 py-5 shadow-sm md:sticky md:top-4">
        <div class="space-y-1">
          <h2 class="text-lg font-semibold">{composerTitle}</h2>
          <p class="text-xs leading-relaxed text-base-content/60">Use a plain prompt and simple cadence. Scheduled Fires create normal board Tasks.</p>
        </div>
        <form class="mt-5 flex flex-col gap-4" onsubmit={(event) => { event.preventDefault(); void saveSchedule() }}>
          <label class="form-control flex w-full flex-col gap-1">
            <span class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Title</span>
            <input class="input input-bordered w-full" bind:value={draft.title} placeholder="Daily dependency triage" required />
          </label>

          <label class="form-control flex w-full flex-col gap-1">
            <span class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Plain prompt</span>
            <textarea class="textarea textarea-bordered min-h-40 w-full resize-y leading-relaxed" bind:value={draft.prompt} placeholder="Describe the Task to create on each Scheduled Fire" required></textarea>
          </label>

          {#if draft.advancedCron}
            <label class="form-control flex w-full flex-col gap-1">
              <span class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Cron expression</span>
              <input class="input input-bordered w-full font-mono" bind:value={draft.cron} placeholder="*/30 * * * *" />
            </label>
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
            <input class="checkbox checkbox-primary checkbox-sm" type="checkbox" bind:checked={draft.advancedCron} />
            <span>Advanced: use a cron expression</span>
          </label>

          <label class="form-control flex w-full flex-col gap-1">
            <span class="label-text text-xs font-medium uppercase tracking-wide text-base-content/60">Mode</span>
            <select class="select select-bordered w-full" bind:value={draft.mode}>
              <option value="create-and-start">Create + start</option>
              <option value="create-only">Create only</option>
            </select>
          </label>

          <label class="flex min-h-11 items-center gap-3 rounded-box bg-base-200/60 px-3 text-sm">
            <input class="toggle toggle-primary" type="checkbox" bind:checked={draft.enabled} />
            <span>Enabled by default</span>
          </label>

          <div class="flex flex-wrap gap-2 pt-1">
            <button class="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Task Schedule'}</button>
            {#if draft.id}
              <button class="btn btn-ghost" type="button" onclick={() => { draft = emptyDraft() }}>Cancel</button>
            {/if}
          </div>
        </form>
      </aside>
    </div>
  {/if}
  </div>
</div>
