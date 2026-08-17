<script lang="ts">
  import { CalendarClock, Plus } from '@lucide/svelte'
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import PluginPageHeader from '@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte'
  import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import { dayOfWeekFromCron, describeCronExpression, timeOfDayFromCron, validateCronCadence, validateFiveFieldCron } from '../lib/cron'
  import { createTaskSchedulesIpc } from '../lib/ipc'
  import type { ScheduledFireOutcome, TaskSchedule, TaskScheduleDraft } from '../lib/types'
  import type { ScheduleDraft, ScheduleFieldErrors, ScheduleFilter, ScheduleRunState, ScheduleSortKey, SortDirection } from '../lib/viewTypes'
  import TaskScheduleComposerSection from './TaskScheduleComposerSection.svelte'
  import TaskScheduleInspector from './TaskScheduleInspector.svelte'
  import TaskSchedulesListSection from './TaskSchedulesListSection.svelte'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectId: string | null
    projectName?: string
  }

  const CRON_HELP_TEXT = 'Use five fields: minute hour day-of-month month day-of-week. Runs at most once every 5 minutes.'

  let { api, context: _context, projectId }: Props = $props()
  let ipc = $derived(createTaskSchedulesIpc(api))

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

  const emptyDraft = (): ScheduleDraft => ({
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
  let draft = $state<ScheduleDraft>(emptyDraft())
  let fieldErrors = $state<ScheduleFieldErrors>({ cron: null })
  let loading = $state(false)
  let saving = $state(false)
  let updatingScheduleId = $state<string | null>(null)
  let deleting = $state(false)
  let selectedScheduleId = $state<string | null>(null)
  let panelMode = $state<'details' | 'form' | null>(null)
  let filter = $state<ScheduleFilter>('all')
  let sortKey = $state<ScheduleSortKey>('nextFireAt')
  let sortDirection = $state<SortDirection>('ascending')
  let runState = $state<ScheduleRunState | null>(null)
  let error = $state<string | null>(null)
  let draftDirty = $state(false)
  let showDiscardConfirmation = $state(false)
  let schedulePendingDelete = $state<TaskSchedule | null>(null)
  let afterDiscard: (() => void) | null = null
  let previousProjectId: string | null = null
  let loadRequestId = 0
  let titleFocusRequest = $state(0)
  let errorFocusRequest = $state(0)
  let announcement = $state('')
  let newScheduleButton = $state<HTMLButtonElement | null>(null)

  let selectedSchedule = $derived(schedules.find((schedule) => schedule.id === selectedScheduleId) ?? null)
  let enabledCount = $derived(schedules.filter((schedule) => schedule.enabled).length)
  let nextRunAt = $derived.by(() => {
    const enabledRuns = schedules.filter((schedule) => schedule.enabled).map((schedule) => schedule.nextFireAt)
    return enabledRuns.length > 0 ? Math.min(...enabledRuns) : null
  })
  let visibleSchedules = $derived.by(() => {
    const filtered = schedules.filter((schedule) => {
      if (filter === 'enabled' && !schedule.enabled) return false
      if (filter === 'paused' && schedule.enabled) return false
      return true
    })
    return [...filtered].sort(compareSchedules)
  })
  let composerTitle = $derived(draft.id ? 'Edit schedule' : 'New schedule')
  let enabledToggleLabel = $derived(draft.id ? (draft.enabled ? 'Schedule enabled' : 'Schedule paused') : 'Enable after creation')
  let timezone = $derived(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local timezone')

  $effect(() => {
    if (projectId === previousProjectId) return
    previousProjectId = projectId
    loadRequestId += 1
    resetWorkspace()
    if (projectId) void loadSchedules(projectId)
  })

  function resetWorkspace(): void {
    schedules = []
    selectedScheduleId = null
    panelMode = null
    draft = emptyDraft()
    draftDirty = false
    fieldErrors = { cron: null }
    runState = null
    error = null
    filter = 'all'
    schedulePendingDelete = null
    showDiscardConfirmation = false
  }

  function isCurrentLoad(activeProjectId: string, requestId: number): boolean {
    return projectId === activeProjectId && requestId === loadRequestId
  }

  async function loadSchedules(activeProjectId: string): Promise<void> {
    const requestId = ++loadRequestId
    loading = true
    error = null
    try {
      const loadedSchedules = await ipc.list(activeProjectId)
      if (!isCurrentLoad(activeProjectId, requestId)) return
      schedules = loadedSchedules
      if (selectedScheduleId && !loadedSchedules.some((schedule) => schedule.id === selectedScheduleId)) {
        selectedScheduleId = null
        panelMode = null
      }
    } catch (cause) {
      if (!isCurrentLoad(activeProjectId, requestId)) return
      error = messageForAsyncError(cause)
    } finally {
      if (isCurrentLoad(activeProjectId, requestId)) loading = false
    }
  }

  function compareSchedules(a: TaskSchedule, b: TaskSchedule): number {
    let comparison = 0
    if (sortKey === 'title') comparison = a.title.localeCompare(b.title)
    else if (sortKey === 'cadence') comparison = cadenceLabel(a).localeCompare(cadenceLabel(b))
    else if (sortKey === 'mode') comparison = a.mode.localeCompare(b.mode)
    else if (sortKey === 'nextFireAt') comparison = a.nextFireAt - b.nextFireAt
    else if (sortKey === 'lastResult') comparison = (a.history.at(-1)?.firedAt ?? 0) - (b.history.at(-1)?.firedAt ?? 0)
    else comparison = Number(b.enabled) - Number(a.enabled)
    if (comparison === 0) comparison = a.title.localeCompare(b.title)
    return sortDirection === 'ascending' ? comparison : -comparison
  }

  function handleSort(nextKey: ScheduleSortKey): void {
    if (sortKey === nextKey) {
      sortDirection = sortDirection === 'ascending' ? 'descending' : 'ascending'
      return
    }
    sortKey = nextKey
    sortDirection = 'ascending'
  }

  function selectSchedule(schedule: TaskSchedule): void {
    requestPanelChange(() => {
      selectedScheduleId = schedule.id
      panelMode = 'details'
      announcement = `Showing ${schedule.title}`
    })
  }

  function openNewSchedule(): void {
    requestPanelChange(() => {
      draft = emptyDraft()
      fieldErrors = { cron: null }
      draftDirty = false
      panelMode = 'form'
      titleFocusRequest += 1
      announcement = 'New schedule form opened'
    })
  }

  function editSchedule(schedule: TaskSchedule): void {
    draft = draftFromSchedule(schedule)
    fieldErrors = { cron: null }
    draftDirty = false
    panelMode = 'form'
    titleFocusRequest += 1
    announcement = `Editing ${schedule.title}`
  }

  function requestPanelChange(action: () => void): void {
    if (panelMode === 'form' && draftDirty) {
      afterDiscard = action
      showDiscardConfirmation = true
      return
    }
    action()
  }

  function requestClosePanel(): void {
    requestPanelChange(() => {
      panelMode = null
      draft = emptyDraft()
      draftDirty = false
      queueMicrotask(() => newScheduleButton?.focus())
    })
  }

  function discardChanges(): void {
    const action = afterDiscard
    afterDiscard = null
    showDiscardConfirmation = false
    draftDirty = false
    action?.()
  }

  function draftFromSchedule(schedule: TaskSchedule): ScheduleDraft {
    return {
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

  function handleDraftChange(nextDraft: ScheduleDraft): void {
    draft = nextDraft
    draftDirty = true
  }

  async function saveSchedule(): Promise<void> {
    if (!projectId) return
    error = null
    fieldErrors = { cron: null }
    if (!validateDraft(true)) return

    saving = true
    try {
      const saved = await ipc.save(projectId, draftToPayload(draft))
      schedules = schedules.some((schedule) => schedule.id === saved.id)
        ? schedules.map((schedule) => schedule.id === saved.id ? saved : schedule)
        : [...schedules, saved]
      selectedScheduleId = saved.id
      panelMode = 'details'
      draft = emptyDraft()
      draftDirty = false
      announcement = `${saved.title} saved`
    } catch (cause) {
      handleSaveError(cause)
    } finally {
      saving = false
    }
  }

  async function toggleSchedule(schedule: TaskSchedule): Promise<void> {
    if (!projectId || updatingScheduleId) return
    updatingScheduleId = schedule.id
    error = null
    try {
      const saved = await ipc.save(projectId, {
        ...draftToPayload(draftFromSchedule(schedule)),
        enabled: !schedule.enabled,
      })
      schedules = schedules.map((candidate) => candidate.id === saved.id ? saved : candidate)
      announcement = `${saved.title} ${saved.enabled ? 'enabled' : 'paused'}`
    } catch (cause) {
      error = messageForAsyncError(cause)
    } finally {
      updatingScheduleId = null
    }
  }

  async function deleteSchedule(): Promise<void> {
    if (!projectId || !schedulePendingDelete || deleting) return
    const deletingSchedule = schedulePendingDelete
    deleting = true
    error = null
    try {
      await ipc.delete(projectId, deletingSchedule.id)
      schedules = schedules.filter((schedule) => schedule.id !== deletingSchedule.id)
      if (selectedScheduleId === deletingSchedule.id) {
        selectedScheduleId = null
        panelMode = null
      }
      schedulePendingDelete = null
      announcement = `${deletingSchedule.title} deleted`
    } catch (cause) {
      error = messageForAsyncError(cause)
    } finally {
      deleting = false
    }
  }

  async function runNow(scheduleId: string): Promise<void> {
    if (!projectId || runState?.phase === 'running' || runState?.phase === 'cancelling') return
    runState = { scheduleId, phase: 'running', message: 'Creating the scheduled task…' }
    try {
      const outcome = await ipc.runNow(projectId, scheduleId)
      runState = runStateFromOutcome(scheduleId, outcome)
      await loadSchedules(projectId)
    } catch (cause) {
      const message = messageForAsyncError(cause)
      runState = {
        scheduleId,
        phase: message.toLowerCase().includes('already running') ? 'already-running' : 'failure',
        message,
      }
    }
  }

  async function cancelRun(scheduleId: string): Promise<void> {
    if (!projectId || runState?.scheduleId !== scheduleId || runState.phase !== 'running') return
    runState = { scheduleId, phase: 'cancelling', message: 'Waiting for the current safe cancellation point…' }
    try {
      const result = await ipc.cancelRunNow(projectId, scheduleId)
      if (!result.cancelled) {
        runState = { scheduleId, phase: 'warning', message: 'The run finished before it could be cancelled.' }
      }
    } catch (cause) {
      runState = { scheduleId, phase: 'failure', message: messageForAsyncError(cause) }
    }
  }

  function runStateFromOutcome(scheduleId: string, outcome: ScheduledFireOutcome): ScheduleRunState {
    if (outcome.status === 'failed') return { scheduleId, phase: 'failure', message: outcome.message }
    if (outcome.status === 'skipped') return { scheduleId, phase: 'warning', message: outcome.message }
    if (outcome.status === 'cancelled') return { scheduleId, phase: 'cancelled', message: outcome.message }
    return { scheduleId, phase: 'success', message: outcome.message }
  }

  function validateDraft(focusError = false): boolean {
    if (!draft.advancedCron) return true
    const validation = validateFiveFieldCron(draft.cron)
    if (!validation.valid) {
      fieldErrors = { cron: CRON_HELP_TEXT }
      error = 'Fix the highlighted schedule fields and try again.'
      if (focusError) errorFocusRequest += 1
      return false
    }
    const cadence = validateCronCadence(draft.cron, Date.now())
    if (!cadence.valid) {
      fieldErrors = { cron: cadence.error }
      error = 'Fix the highlighted schedule fields and try again.'
      if (focusError) errorFocusRequest += 1
      return false
    }
    return true
  }

  function handleSaveError(cause: unknown): void {
    if (isCronError(cause)) {
      fieldErrors = { cron: CRON_HELP_TEXT }
      error = 'Fix the highlighted schedule fields and try again.'
      errorFocusRequest += 1
      return
    }
    error = messageForAsyncError(cause)
  }

  function draftToPayload(currentDraft: ScheduleDraft): TaskScheduleDraft {
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

  function cadenceLabel(schedule: TaskSchedule): string {
    if (schedule.preset === 'custom') return 'Custom'
    const time = timeOfDayFromCron(schedule.cron)
    if (schedule.preset === 'weekly') {
      const day = dayOfWeekOptions.find((option) => option.value === dayOfWeekFromCron(schedule.cron))?.label ?? 'Weekly'
      return `${day} · ${time}`
    }
    if (schedule.preset === 'monthly') return `Monthly · ${time}`
    return `Daily · ${time}`
  }

  function cadenceDescription(schedule: TaskSchedule): string | null {
    return schedule.preset === 'custom' ? describeCronExpression(schedule.cron) : null
  }

  function formatDate(value: number | null): string {
    if (value === null) return 'Never'
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  }

  function messageForAsyncError(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
  }

  function isCronError(cause: unknown): boolean {
    const message = messageForAsyncError(cause).toLowerCase()
    return message.includes('cron') || message.includes('schedule preset') || message.includes('field')
  }

  function openTask(taskId: string): void {
    void api.navigation.navigate({ projectId, taskId }).catch((cause) => {
      error = `Could not open ${taskId}: ${messageForAsyncError(cause)}`
    })
  }
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden bg-base-100">
  <PluginPageHeader title="Task Schedules" subtitle="Create recurring project tasks and implementation runs" surface="default">
    {#snippet actions()}
      {#if projectId}
        <button bind:this={newScheduleButton} class="btn btn-primary min-h-10" type="button" onclick={openNewSchedule}>
          <Plus class="size-4" aria-hidden="true" /> New schedule
        </button>
      {/if}
    {/snippet}
  </PluginPageHeader>

  <div class="sr-only" role="status" aria-live="polite">{announcement}</div>

  {#if !projectId}
    <PluginViewState empty emptyTitle="Select a project to manage Task Schedules." />
  {:else}
    {#if error}
      <div class="mx-5 mt-4 flex items-center justify-between gap-4 rounded-box border border-error/30 bg-error/10 px-4 py-3 text-sm text-error" role="alert" aria-live="assertive">
        <span>{error}</span>
        <button class="btn btn-sm min-h-9" type="button" onclick={() => loadSchedules(projectId)}>Retry</button>
      </div>
    {/if}

    <div class="flex min-h-0 flex-1">
      <main class="min-w-0 flex-1 overflow-auto px-5 py-5" aria-label="Task schedules workspace">
        <div class="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div class="flex flex-wrap gap-3" aria-label="Schedule summary">
            <div class="min-w-28 rounded-box border border-base-300 bg-base-100 px-4 py-3"><strong class="block text-xl tabular-nums">{schedules.length}</strong><span class="text-xs text-secondary">{schedules.length === 1 ? 'schedule' : 'schedules'}</span></div>
            <div class="min-w-28 rounded-box border border-base-300 bg-base-100 px-4 py-3"><strong class="block text-xl tabular-nums">{enabledCount}</strong><span class="text-xs text-secondary">enabled</span></div>
            <div class="flex min-w-48 items-center gap-3 rounded-box border border-base-300 bg-base-100 px-4 py-3"><CalendarClock class="size-5 text-secondary" aria-hidden="true" /><span><span class="block text-xs text-secondary">Next run</span><strong class="mt-0.5 block text-sm font-medium tabular-nums">{nextRunAt === null ? 'None scheduled' : formatDate(nextRunAt)}</strong></span></div>
          </div>

          <div class="join rounded-box border border-base-300 bg-base-100 p-1" aria-label="Filter schedules">
            <button class="btn join-item min-h-9 border-0 {filter === 'all' ? 'btn-primary' : 'btn-ghost'}" type="button" aria-label="All schedules" aria-pressed={filter === 'all'} onclick={() => { filter = 'all' }}>All</button>
            <button class="btn join-item min-h-9 border-0 {filter === 'enabled' ? 'btn-primary' : 'btn-ghost'}" type="button" aria-label="Enabled schedules" aria-pressed={filter === 'enabled'} onclick={() => { filter = 'enabled' }}>Enabled</button>
            <button class="btn join-item min-h-9 border-0 {filter === 'paused' ? 'btn-primary' : 'btn-ghost'}" type="button" aria-label="Paused schedules" aria-pressed={filter === 'paused'} onclick={() => { filter = 'paused' }}>Paused</button>
          </div>
        </div>

        {#if !loading && schedules.length > 0 && visibleSchedules.length === 0}
          <div class="flex min-h-64 items-center justify-center rounded-box border border-dashed border-base-300 bg-base-100 p-8 text-center">
            <div><CalendarClock class="mx-auto size-8 text-secondary" aria-hidden="true" /><h3 class="mt-3 font-semibold">No matching schedules</h3><p class="mt-1 text-sm text-secondary">Choose another status filter.</p></div>
          </div>
        {:else}
          <TaskSchedulesListSection
            {loading}
            schedules={visibleSchedules}
            {selectedScheduleId}
            {sortKey}
            {sortDirection}
            onSelectSchedule={selectSchedule}
            onSort={handleSort}
            onOpenTask={openTask}
            {cadenceLabel}
            {formatDate}
          />
        {/if}
      </main>

      {#if panelMode === 'details' && selectedSchedule}
        <ResizablePanel storageKey="task-schedules-inspector" defaultWidth={430} minWidth={340} maxWidth={620} side="right" label="schedule details">
          <TaskScheduleInspector
            schedule={selectedSchedule}
            runState={runState?.scheduleId === selectedSchedule.id ? runState : null}
            updating={updatingScheduleId === selectedSchedule.id}
            {timezone}
            {cadenceLabel}
            {cadenceDescription}
            {formatDate}
            onClose={requestClosePanel}
            onRunNow={(scheduleId) => { void runNow(scheduleId) }}
            onCancelRun={(scheduleId) => { void cancelRun(scheduleId) }}
            onEdit={editSchedule}
            onToggleEnabled={(schedule) => { void toggleSchedule(schedule) }}
            onRequestDelete={(schedule) => { schedulePendingDelete = schedule }}
            onOpenTask={openTask}
          />
        </ResizablePanel>
      {:else if panelMode === 'form'}
        <ResizablePanel storageKey="task-schedules-form" defaultWidth={460} minWidth={360} maxWidth={640} side="right" label="schedule form">
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
            {errorFocusRequest}
            onDraftChange={handleDraftChange}
            onFieldErrorsChange={(nextErrors) => { fieldErrors = nextErrors }}
            onValidateDraft={() => { validateDraft() }}
            onSaveSchedule={() => { void saveSchedule() }}
            onClose={requestClosePanel}
          />
        </ResizablePanel>
      {/if}
    </div>
  {/if}
</div>

{#if showDiscardConfirmation}
  <Modal ariaLabel="Discard schedule changes" maxWidth="420px" initialFocus="#discard-schedule-changes" onClose={() => { showDiscardConfirmation = false; afterDiscard = null }}>
    {#snippet header()}<h2 class="text-lg font-semibold">Discard unsaved changes?</h2>{/snippet}
    <p class="text-sm leading-6 text-secondary">Your changes to this schedule have not been saved.</p>
    <div class="mt-5 flex justify-end gap-2">
      <button class="btn min-h-10" type="button" onclick={() => { showDiscardConfirmation = false; afterDiscard = null }}>Keep editing</button>
      <button id="discard-schedule-changes" class="btn btn-error min-h-10" type="button" onclick={discardChanges}>Discard changes</button>
    </div>
  </Modal>
{/if}

{#if schedulePendingDelete}
  <Modal ariaLabel="Delete schedule confirmation" maxWidth="420px" initialFocus="#confirm-delete-schedule" closeDisabled={deleting} onClose={() => { if (!deleting) schedulePendingDelete = null }}>
    {#snippet header()}<h2 class="text-lg font-semibold">Delete {schedulePendingDelete.title}?</h2>{/snippet}
    <p class="text-sm leading-6 text-secondary">This permanently deletes the schedule. Existing tasks and run history outside this schedule are not removed.</p>
    <div class="mt-5 flex justify-end gap-2">
      <button class="btn min-h-10" type="button" disabled={deleting} onclick={() => { schedulePendingDelete = null }}>Cancel</button>
      <button id="confirm-delete-schedule" class="btn btn-error min-h-10" type="button" disabled={deleting} onclick={() => { void deleteSchedule() }}>{deleting ? 'Deleting…' : 'Delete schedule'}</button>
    </div>
  </Modal>
{/if}
