import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import { createTaskSchedulesIpc } from '../lib/ipc'
import {
  cadenceDescription,
  cadenceLabel,
  CRON_HELP_TEXT,
  DAY_OF_WEEK_OPTIONS,
  draftCronError,
  draftFromSchedule,
  draftToPayload,
  emptyScheduleDraft,
  formatScheduleDate,
  isCronError,
  messageForAsyncError,
  runStateFromOutcome,
  TIME_OPTIONS,
  visibleSchedules,
} from '../lib/taskSchedulesViewModel'
import type { TaskSchedule } from '../lib/types'
import type { ScheduleDraft, ScheduleFieldErrors, ScheduleFilter, ScheduleRunState, ScheduleSortKey, SortDirection } from '../lib/viewTypes'

type PanelMode = 'details' | 'form' | null

interface TaskSchedulesControllerOptions {
  getApi(): FrontendOpenForgeAPI
  getProjectId(): string | null
}

export function useTaskSchedulesController(options: TaskSchedulesControllerOptions) {
  const api = $derived(options.getApi())
  const ipc = $derived(createTaskSchedulesIpc(api))
  const projectId = $derived(options.getProjectId())

  let schedules = $state<TaskSchedule[]>([])
  let draft = $state<ScheduleDraft>(emptyScheduleDraft())
  let fieldErrors = $state<ScheduleFieldErrors>({ cron: null })
  let loading = $state(false)
  let saving = $state(false)
  let updatingScheduleId = $state<string | null>(null)
  let deleting = $state(false)
  let selectedScheduleId = $state<string | null>(null)
  let panelMode = $state<PanelMode>(null)
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
  let newScheduleFocusRequest = $state(0)
  let announcement = $state('')

  const selectedSchedule = $derived(schedules.find((schedule) => schedule.id === selectedScheduleId) ?? null)
  const enabledCount = $derived(schedules.filter((schedule) => schedule.enabled).length)
  const nextRunAt = $derived.by(() => {
    const enabledRuns = schedules.filter((schedule) => schedule.enabled).map((schedule) => schedule.nextFireAt)
    return enabledRuns.length > 0 ? Math.min(...enabledRuns) : null
  })
  const filteredSchedules = $derived(visibleSchedules(schedules, filter, sortKey, sortDirection))
  const composerTitle = $derived(draft.id ? 'Edit schedule' : 'New schedule')
  const enabledToggleLabel = $derived(draft.id ? (draft.enabled ? 'Schedule enabled' : 'Schedule paused') : 'Enable after creation')
  const timezone = $derived(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local timezone')

  $effect(() => {
    if (projectId === previousProjectId) return
    previousProjectId = projectId
    loadRequestId += 1
    resetWorkspace()
    if (projectId) void loadSchedules(projectId)
  })

  function resetWorkspace(): void {
    schedules = []
    loading = false
    saving = false
    updatingScheduleId = null
    deleting = false
    selectedScheduleId = null
    panelMode = null
    draft = emptyScheduleDraft()
    draftDirty = false
    fieldErrors = { cron: null }
    runState = null
    error = null
    filter = 'all'
    schedulePendingDelete = null
    showDiscardConfirmation = false
    afterDiscard = null
  }

  function isCurrentProject(activeProjectId: string): boolean {
    return projectId === activeProjectId
  }

  function isCurrentLoad(activeProjectId: string, requestId: number): boolean {
    return isCurrentProject(activeProjectId) && requestId === loadRequestId
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

  function retryLoad(): void {
    if (projectId) void loadSchedules(projectId)
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
      draft = emptyScheduleDraft()
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
      draft = emptyScheduleDraft()
      draftDirty = false
      newScheduleFocusRequest += 1
    })
  }

  function cancelDiscard(): void {
    showDiscardConfirmation = false
    afterDiscard = null
  }

  function discardChanges(): void {
    const action = afterDiscard
    afterDiscard = null
    showDiscardConfirmation = false
    draftDirty = false
    action?.()
  }

  function handleDraftChange(nextDraft: ScheduleDraft): void {
    draft = nextDraft
    draftDirty = true
  }

  function setFieldErrors(nextErrors: ScheduleFieldErrors): void {
    fieldErrors = nextErrors
  }

  function validateDraft(focusError = false): boolean {
    const cronError = draftCronError(draft)
    if (!cronError) return true
    fieldErrors = { cron: cronError }
    error = 'Fix the highlighted schedule fields and try again.'
    if (focusError) errorFocusRequest += 1
    return false
  }

  async function saveSchedule(): Promise<void> {
    const activeProjectId = projectId
    if (!activeProjectId) return
    error = null
    fieldErrors = { cron: null }
    if (!validateDraft(true)) return

    saving = true
    try {
      const saved = await ipc.save(activeProjectId, draftToPayload(draft))
      if (!isCurrentProject(activeProjectId)) return
      schedules = schedules.some((schedule) => schedule.id === saved.id)
        ? schedules.map((schedule) => schedule.id === saved.id ? saved : schedule)
        : [...schedules, saved]
      selectedScheduleId = saved.id
      panelMode = 'details'
      draft = emptyScheduleDraft()
      draftDirty = false
      announcement = `${saved.title} saved`
    } catch (cause) {
      if (!isCurrentProject(activeProjectId)) return
      handleSaveError(cause)
    } finally {
      if (isCurrentProject(activeProjectId)) saving = false
    }
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

  async function toggleSchedule(schedule: TaskSchedule): Promise<void> {
    const activeProjectId = projectId
    if (!activeProjectId || updatingScheduleId) return
    updatingScheduleId = schedule.id
    error = null
    try {
      const saved = await ipc.save(activeProjectId, {
        ...draftToPayload(draftFromSchedule(schedule)),
        enabled: !schedule.enabled,
      })
      if (!isCurrentProject(activeProjectId)) return
      schedules = schedules.map((candidate) => candidate.id === saved.id ? saved : candidate)
      announcement = `${saved.title} ${saved.enabled ? 'enabled' : 'paused'}`
    } catch (cause) {
      if (!isCurrentProject(activeProjectId)) return
      error = messageForAsyncError(cause)
    } finally {
      if (isCurrentProject(activeProjectId)) updatingScheduleId = null
    }
  }

  function requestDelete(schedule: TaskSchedule): void {
    schedulePendingDelete = schedule
  }

  function cancelDelete(): void {
    if (!deleting) schedulePendingDelete = null
  }

  async function deleteSchedule(): Promise<void> {
    const activeProjectId = projectId
    if (!activeProjectId || !schedulePendingDelete || deleting) return
    const deletingSchedule = schedulePendingDelete
    deleting = true
    error = null
    try {
      await ipc.delete(activeProjectId, deletingSchedule.id)
      if (!isCurrentProject(activeProjectId)) return
      schedules = schedules.filter((schedule) => schedule.id !== deletingSchedule.id)
      if (selectedScheduleId === deletingSchedule.id) {
        selectedScheduleId = null
        panelMode = null
      }
      schedulePendingDelete = null
      announcement = `${deletingSchedule.title} deleted`
    } catch (cause) {
      if (!isCurrentProject(activeProjectId)) return
      error = messageForAsyncError(cause)
    } finally {
      if (isCurrentProject(activeProjectId)) deleting = false
    }
  }

  async function runNow(scheduleId: string): Promise<void> {
    const activeProjectId = projectId
    if (!activeProjectId || runState?.phase === 'running' || runState?.phase === 'cancelling') return
    runState = { scheduleId, phase: 'running', message: 'Creating the scheduled task…' }
    try {
      const outcome = await ipc.runNow(activeProjectId, scheduleId)
      if (!isCurrentProject(activeProjectId)) return
      runState = runStateFromOutcome(scheduleId, outcome)
      await loadSchedules(activeProjectId)
    } catch (cause) {
      if (!isCurrentProject(activeProjectId)) return
      const message = messageForAsyncError(cause)
      runState = {
        scheduleId,
        phase: message.toLowerCase().includes('already running') ? 'already-running' : 'failure',
        message,
      }
    }
  }

  async function cancelRun(scheduleId: string): Promise<void> {
    const activeProjectId = projectId
    if (!activeProjectId || runState?.scheduleId !== scheduleId || runState.phase !== 'running') return
    runState = { scheduleId, phase: 'cancelling', message: 'Waiting for the current safe cancellation point…' }
    try {
      const result = await ipc.cancelRunNow(activeProjectId, scheduleId)
      if (!isCurrentProject(activeProjectId)) return
      if (!result.cancelled) {
        runState = { scheduleId, phase: 'warning', message: 'The run finished before it could be cancelled.' }
      }
    } catch (cause) {
      if (!isCurrentProject(activeProjectId)) return
      runState = { scheduleId, phase: 'failure', message: messageForAsyncError(cause) }
    }
  }

  function openTask(taskId: string): void {
    const activeProjectId = projectId
    if (!activeProjectId) return
    void api.navigation.navigate({ projectId: activeProjectId, taskId }).catch((cause) => {
      if (!isCurrentProject(activeProjectId)) return
      error = `Could not open ${taskId}: ${messageForAsyncError(cause)}`
    })
  }

  return {
    get projectId() { return projectId },
    get schedules() { return schedules },
    get draft() { return draft },
    get fieldErrors() { return fieldErrors },
    get loading() { return loading },
    get saving() { return saving },
    get updatingScheduleId() { return updatingScheduleId },
    get deleting() { return deleting },
    get selectedScheduleId() { return selectedScheduleId },
    get selectedSchedule() { return selectedSchedule },
    get panelMode() { return panelMode },
    get filter() { return filter },
    get sortKey() { return sortKey },
    get sortDirection() { return sortDirection },
    get runState() { return runState },
    get error() { return error },
    get showDiscardConfirmation() { return showDiscardConfirmation },
    get schedulePendingDelete() { return schedulePendingDelete },
    get titleFocusRequest() { return titleFocusRequest },
    get errorFocusRequest() { return errorFocusRequest },
    get newScheduleFocusRequest() { return newScheduleFocusRequest },
    get announcement() { return announcement },
    get enabledCount() { return enabledCount },
    get nextRunAt() { return nextRunAt },
    get visibleSchedules() { return filteredSchedules },
    get composerTitle() { return composerTitle },
    get enabledToggleLabel() { return enabledToggleLabel },
    get timezone() { return timezone },
    cronHelpText: CRON_HELP_TEXT,
    timeOptions: TIME_OPTIONS,
    dayOfWeekOptions: DAY_OF_WEEK_OPTIONS,
    cadenceLabel,
    cadenceDescription,
    formatDate: formatScheduleDate,
    setFilter(nextFilter: ScheduleFilter) { filter = nextFilter },
    handleSort,
    selectSchedule,
    openNewSchedule,
    editSchedule,
    requestClosePanel,
    cancelDiscard,
    discardChanges,
    handleDraftChange,
    setFieldErrors,
    validateDraft,
    saveSchedule,
    toggleSchedule,
    requestDelete,
    cancelDelete,
    deleteSchedule,
    runNow,
    cancelRun,
    openTask,
    retryLoad,
  }
}

export type TaskSchedulesController = ReturnType<typeof useTaskSchedulesController>
