import {
  CRON_HELP_TEXT,
  draftCronError,
  draftFromSchedule,
  emptyScheduleDraft,
} from '../lib/taskSchedulesViewModel'
import type { TaskSchedule } from '../lib/types'
import type {
  ScheduleDraft,
  ScheduleFieldErrors,
  ScheduleFilter,
  ScheduleSortKey,
  SortDirection,
} from '../lib/viewTypes'

export type SchedulePanelMode = 'details' | 'form' | null

interface TaskSchedulesComposerStateOptions {
  announce(message: string): void
  reportError(message: string): void
}

export function useTaskSchedulesComposerState(options: TaskSchedulesComposerStateOptions) {
  let draft = $state<ScheduleDraft>(emptyScheduleDraft())
  let fieldErrors = $state<ScheduleFieldErrors>({ cron: null })
  let selectedScheduleId = $state<string | null>(null)
  let panelMode = $state<SchedulePanelMode>(null)
  let filter = $state<ScheduleFilter>('all')
  let sortKey = $state<ScheduleSortKey>('nextFireAt')
  let sortDirection = $state<SortDirection>('ascending')
  let draftDirty = $state(false)
  let showDiscardConfirmation = $state(false)
  let schedulePendingDelete = $state<TaskSchedule | null>(null)
  let afterDiscard: (() => void) | null = null
  let titleFocusRequest = $state(0)
  let errorFocusRequest = $state(0)
  let newScheduleFocusRequest = $state(0)

  const composerTitle = $derived(draft.id ? 'Edit schedule' : 'New schedule')
  const enabledToggleLabel = $derived(draft.id ? (draft.enabled ? 'Schedule enabled' : 'Schedule paused') : 'Enable after creation')

  function resetWorkspace(): void {
    selectedScheduleId = null
    panelMode = null
    draft = emptyScheduleDraft()
    draftDirty = false
    fieldErrors = { cron: null }
    filter = 'all'
    schedulePendingDelete = null
    showDiscardConfirmation = false
    afterDiscard = null
  }

  function reconcileSchedules(schedules: TaskSchedule[]): void {
    if (selectedScheduleId && !schedules.some((schedule) => schedule.id === selectedScheduleId)) {
      selectedScheduleId = null
      panelMode = null
    }
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
      options.announce(`Showing ${schedule.title}`)
    })
  }

  function openNewSchedule(): void {
    requestPanelChange(() => {
      draft = emptyScheduleDraft()
      fieldErrors = { cron: null }
      draftDirty = false
      panelMode = 'form'
      titleFocusRequest += 1
      options.announce('New schedule form opened')
    })
  }

  function editSchedule(schedule: TaskSchedule): void {
    draft = draftFromSchedule(schedule)
    fieldErrors = { cron: null }
    draftDirty = false
    panelMode = 'form'
    titleFocusRequest += 1
    options.announce(`Editing ${schedule.title}`)
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
    options.reportError('Fix the highlighted schedule fields and try again.')
    if (focusError) errorFocusRequest += 1
    return false
  }

  function prepareDraftForSave(): ScheduleDraft | null {
    fieldErrors = { cron: null }
    return validateDraft(true) ? draft : null
  }

  function handleCronSaveError(): void {
    fieldErrors = { cron: CRON_HELP_TEXT }
    errorFocusRequest += 1
  }

  function completeSave(saved: TaskSchedule): void {
    selectedScheduleId = saved.id
    panelMode = 'details'
    draft = emptyScheduleDraft()
    draftDirty = false
  }

  function requestDelete(schedule: TaskSchedule): void {
    schedulePendingDelete = schedule
  }

  function cancelDelete(deleting: boolean): void {
    if (!deleting) schedulePendingDelete = null
  }

  function completeDelete(deletedSchedule: TaskSchedule): void {
    if (selectedScheduleId === deletedSchedule.id) {
      selectedScheduleId = null
      panelMode = null
    }
    schedulePendingDelete = null
  }

  return {
    get draft() { return draft },
    get fieldErrors() { return fieldErrors },
    get selectedScheduleId() { return selectedScheduleId },
    get panelMode() { return panelMode },
    get filter() { return filter },
    get sortKey() { return sortKey },
    get sortDirection() { return sortDirection },
    get showDiscardConfirmation() { return showDiscardConfirmation },
    get schedulePendingDelete() { return schedulePendingDelete },
    get titleFocusRequest() { return titleFocusRequest },
    get errorFocusRequest() { return errorFocusRequest },
    get newScheduleFocusRequest() { return newScheduleFocusRequest },
    get composerTitle() { return composerTitle },
    get enabledToggleLabel() { return enabledToggleLabel },
    setFilter(nextFilter: ScheduleFilter) { filter = nextFilter },
    resetWorkspace,
    reconcileSchedules,
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
    prepareDraftForSave,
    handleCronSaveError,
    completeSave,
    requestDelete,
    cancelDelete,
    completeDelete,
  }
}

export type TaskSchedulesComposerState = ReturnType<typeof useTaskSchedulesComposerState>
