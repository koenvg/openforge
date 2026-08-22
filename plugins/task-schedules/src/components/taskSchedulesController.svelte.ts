import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import {
  cadenceDescription,
  cadenceLabel,
  CRON_HELP_TEXT,
  DAY_OF_WEEK_OPTIONS,
  formatScheduleDate,
  isScheduleEnabled,
  nextScheduleFireAt,
  TIME_OPTIONS,
  visibleSchedules,
} from '../lib/taskSchedulesViewModel'
import type { ScheduleFilter } from '../lib/viewTypes'
import { useTaskSchedulesActionState } from './taskSchedulesActionState.svelte'
import type { TaskSchedulesActionState } from './taskSchedulesActionState.svelte'
import { useTaskSchedulesComposerState } from './taskSchedulesComposerState.svelte'

interface TaskSchedulesControllerOptions {
  getApi(): FrontendOpenForgeAPI
  getProjectId(): string | null
}

export function useTaskSchedulesController(options: TaskSchedulesControllerOptions) {
  let actionState!: TaskSchedulesActionState
  const composerState = useTaskSchedulesComposerState({
    announce(message) { actionState.announce(message) },
    reportError(message) { actionState.setError(message) },
  })
  actionState = useTaskSchedulesActionState({
    ...options,
    onProjectChange: composerState.resetWorkspace,
    onSchedulesLoaded: composerState.reconcileSchedules,
    onScheduleSaved: composerState.completeSave,
    onScheduleDeleted: composerState.completeDelete,
    onCronSaveError: composerState.handleCronSaveError,
  })

  const selectedSchedule = $derived(actionState.schedules.find((schedule) => schedule.id === composerState.selectedScheduleId) ?? null)
  const enabledCount = $derived(actionState.schedules.filter(isScheduleEnabled).length)
  const nextRunAt = $derived.by(() => {
    const enabledRuns = actionState.schedules.flatMap((schedule) => {
      const nextFireAt = nextScheduleFireAt(schedule)
      return isScheduleEnabled(schedule) && nextFireAt !== null ? [nextFireAt] : []
    })
    return enabledRuns.length > 0 ? Math.min(...enabledRuns) : null
  })
  const filteredSchedules = $derived(visibleSchedules(
    actionState.schedules,
    composerState.filter,
    composerState.sortKey,
    composerState.sortDirection,
  ))
  const timezone = $derived(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local timezone')

  async function saveSchedule(): Promise<void> {
    if (!actionState.projectId) return
    actionState.setError(null)
    const draft = composerState.prepareDraftForSave()
    if (draft) await actionState.saveSchedule(draft)
  }

  function cancelDelete(): void {
    composerState.cancelDelete(actionState.deleting)
  }

  async function deleteSchedule(): Promise<void> {
    await actionState.deleteSchedule(composerState.schedulePendingDelete)
  }

  return {
    get projectId() { return actionState.projectId },
    get schedules() { return actionState.schedules },
    get draft() { return composerState.draft },
    get fieldErrors() { return composerState.fieldErrors },
    get loading() { return actionState.loading },
    get saving() { return actionState.saving },
    get updatingScheduleId() { return actionState.updatingScheduleId },
    get deleting() { return actionState.deleting },
    get selectedScheduleId() { return composerState.selectedScheduleId },
    get selectedSchedule() { return selectedSchedule },
    get panelMode() { return composerState.panelMode },
    get filter() { return composerState.filter },
    get sortKey() { return composerState.sortKey },
    get sortDirection() { return composerState.sortDirection },
    get runState() { return actionState.runState },
    get error() { return actionState.error },
    get showDiscardConfirmation() { return composerState.showDiscardConfirmation },
    get schedulePendingDelete() { return composerState.schedulePendingDelete },
    get titleFocusRequest() { return composerState.titleFocusRequest },
    get errorFocusRequest() { return composerState.errorFocusRequest },
    get newScheduleFocusRequest() { return composerState.newScheduleFocusRequest },
    get announcement() { return actionState.announcement },
    get enabledCount() { return enabledCount },
    get nextRunAt() { return nextRunAt },
    get visibleSchedules() { return filteredSchedules },
    get composerTitle() { return composerState.composerTitle },
    get enabledToggleLabel() { return composerState.enabledToggleLabel },
    get timezone() { return timezone },
    cronHelpText: CRON_HELP_TEXT,
    timeOptions: TIME_OPTIONS,
    dayOfWeekOptions: DAY_OF_WEEK_OPTIONS,
    cadenceLabel,
    cadenceDescription,
    formatDate: formatScheduleDate,
    setFilter(nextFilter: ScheduleFilter) { composerState.setFilter(nextFilter) },
    handleSort: composerState.handleSort,
    selectSchedule: composerState.selectSchedule,
    openNewSchedule: composerState.openNewSchedule,
    editSchedule: composerState.editSchedule,
    requestClosePanel: composerState.requestClosePanel,
    cancelDiscard: composerState.cancelDiscard,
    discardChanges: composerState.discardChanges,
    handleDraftChange: composerState.handleDraftChange,
    setFieldErrors: composerState.setFieldErrors,
    validateDraft: composerState.validateDraft,
    saveSchedule,
    toggleSchedule: actionState.toggleSchedule,
    requestDelete: composerState.requestDelete,
    cancelDelete,
    deleteSchedule,
    runNow: actionState.runNow,
    cancelRun: actionState.cancelRun,
    openTask: actionState.openTask,
    retryLoad: actionState.retryLoad,
    refreshSchedules: actionState.refreshSchedules,
  }
}

export type TaskSchedulesController = ReturnType<typeof useTaskSchedulesController>
