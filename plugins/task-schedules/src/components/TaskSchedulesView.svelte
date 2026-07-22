<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import PluginPageHeader from '@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte'
  import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'
  import { dayOfWeekFromCron, describeCronExpression, timeOfDayFromCron, validateCronCadence, validateFiveFieldCron } from '../lib/cron'
  import type { ScheduledFireOutcome, SchedulePreset, TaskSchedule, TaskScheduleDraft, TaskScheduleMode } from '../lib/types'
  import TaskScheduleComposerSection from './TaskScheduleComposerSection.svelte'
  import TaskSchedulesListSection from './TaskSchedulesListSection.svelte'

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
  const CRON_HELP_TEXT = 'Use five fields: minute hour day-of-month month day-of-week. Fires at most once every 5 minutes.'

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
  let titleFocusRequest = $state(0)
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
    titleFocusRequest += 1
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
    if (!validation.valid) {
      fieldErrors = { ...fieldErrors, cron: CRON_HELP_TEXT }
      error = 'Fix the highlighted schedule fields and try again.'
      return false
    }

    const cadence = validateCronCadence(draft.cron, Date.now())
    if (!cadence.valid) {
      fieldErrors = { ...fieldErrors, cron: cadence.error }
      error = 'Fix the highlighted schedule fields and try again.'
      return false
    }

    return true
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
  <PluginPageHeader
    title={`${projectName || 'Project'} — Task Schedules`}
    subtitle="Create recurring project tasks and optional implementation runs."
  >
    {#snippet actions()}
      {#if projectId}
        <button class="btn btn-sm" type="button" disabled={loading} onclick={() => loadSchedules(projectId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      {/if}
    {/snippet}
  </PluginPageHeader>

  <div role="status" aria-live="polite" class="sr-only">{editAnnouncement}</div>

  <div class="flex-1 overflow-auto px-3 py-6 sm:px-4">
  {#if !projectId}
    <PluginViewState empty emptyTitle="Select a project to manage Task Schedules." />
  {:else}
    {#if error}
      <div class="alert alert-error mb-4" role="alert" aria-live="assertive">{error}</div>
    {/if}

    <div class="grid items-start gap-y-6 gap-x-4 md:grid-cols-[minmax(18rem,1fr)_minmax(22rem,28rem)]">
      <TaskSchedulesListSection
        {loading}
        schedules={sortedSchedules}
        {runningScheduleId}
        {deletingScheduleId}
        {confirmingDeleteId}
        onEditSchedule={(schedule) => { void editSchedule(schedule) }}
        onDeleteSchedule={(schedule) => { void deleteSchedule(schedule) }}
        onRunNow={(scheduleId) => { void runNow(scheduleId) }}
        onConfirmDelete={(scheduleId) => { confirmingDeleteId = scheduleId }}
        {runNowDescription}
        {schedulePresetLabel}
        {scheduleHumanDescription}
        {formatDate}
      />

      <TaskScheduleComposerSection
        {draft}
        {fieldErrors}
        {timeOptions}
        {dayOfWeekOptions}
        {composerTitle}
        {enabledToggleLabel}
        {saving}
        cronHelpText={CRON_HELP_TEXT}
        {titleFocusRequest}
        onDraftChange={(nextDraft) => { draft = nextDraft }}
        onFieldErrorsChange={(nextFieldErrors) => { fieldErrors = nextFieldErrors }}
        onValidateDraft={() => { validateDraft() }}
        onSaveSchedule={() => { void saveSchedule() }}
        onCancelEdit={() => { draft = emptyDraft(); fieldErrors = emptyFieldErrors() }}
      />
    </div>
  {/if}
  </div>
</div>
