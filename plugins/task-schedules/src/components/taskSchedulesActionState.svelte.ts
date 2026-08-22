import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import { createTaskSchedulesIpc } from '../lib/ipc'
import {
  draftFromSchedule,
  draftToPayload,
  isCronError,
  messageForAsyncError,
  runStateFromOutcome,
  schedulesWithinOneOffRetention,
} from '../lib/taskSchedulesViewModel'
import type { TaskSchedule } from '../lib/types'
import type { ScheduleDraft, ScheduleRunState } from '../lib/viewTypes'

interface TaskSchedulesActionStateOptions {
  getApi(): FrontendOpenForgeAPI
  getProjectId(): string | null
  onProjectChange(): void
  onSchedulesLoaded(schedules: TaskSchedule[]): void
  onScheduleSaved(schedule: TaskSchedule): void
  onScheduleDeleted(schedule: TaskSchedule): void
  onCronSaveError(): void
}

export function useTaskSchedulesActionState(options: TaskSchedulesActionStateOptions) {
  const api = $derived(options.getApi())
  const ipc = $derived(createTaskSchedulesIpc(api))
  const projectId = $derived(options.getProjectId())

  let schedules = $state<TaskSchedule[]>([])
  let loading = $state(false)
  let saving = $state(false)
  let updatingScheduleId = $state<string | null>(null)
  let deleting = $state(false)
  let runState = $state<ScheduleRunState | null>(null)
  let error = $state<string | null>(null)
  let announcement = $state('')
  let previousProjectId: string | null = null
  let loadRequestId = 0

  $effect(() => {
    if (projectId === previousProjectId) return
    previousProjectId = projectId
    loadRequestId += 1
    resetWorkspace()
    options.onProjectChange()
    if (projectId) void loadSchedules(projectId)
  })

  function resetWorkspace(): void {
    schedules = []
    loading = false
    saving = false
    updatingScheduleId = null
    deleting = false
    runState = null
    error = null
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
      const retainedSchedules = schedulesWithinOneOffRetention(loadedSchedules)
      schedules = retainedSchedules
      options.onSchedulesLoaded(retainedSchedules)
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

  function refreshSchedules(): void {
    const activeProjectId = projectId
    if (!activeProjectId || loading || saving || updatingScheduleId !== null || deleting) return
    void loadSchedules(activeProjectId)
  }

  async function saveSchedule(draft: ScheduleDraft): Promise<void> {
    const activeProjectId = projectId
    if (!activeProjectId) return
    saving = true
    try {
      const saved = await ipc.save(activeProjectId, draftToPayload(draft))
      if (!isCurrentProject(activeProjectId)) return
      schedules = schedules.some((schedule) => schedule.id === saved.id)
        ? schedules.map((schedule) => schedule.id === saved.id ? saved : schedule)
        : [...schedules, saved]
      options.onScheduleSaved(saved)
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
      options.onCronSaveError()
      error = 'Fix the highlighted schedule fields and try again.'
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
        runAt: schedule.runAt,
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

  async function deleteSchedule(schedule: TaskSchedule | null): Promise<void> {
    const activeProjectId = projectId
    if (!activeProjectId || !schedule || deleting) return
    deleting = true
    error = null
    try {
      await ipc.delete(activeProjectId, schedule.id)
      if (!isCurrentProject(activeProjectId)) return
      schedules = schedules.filter((candidate) => candidate.id !== schedule.id)
      options.onScheduleDeleted(schedule)
      announcement = `${schedule.title} deleted`
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
    get loading() { return loading },
    get saving() { return saving },
    get updatingScheduleId() { return updatingScheduleId },
    get deleting() { return deleting },
    get runState() { return runState },
    get error() { return error },
    get announcement() { return announcement },
    setError(message: string | null) { error = message },
    announce(message: string) { announcement = message },
    saveSchedule,
    toggleSchedule,
    deleteSchedule,
    runNow,
    cancelRun,
    openTask,
    retryLoad,
    refreshSchedules,
  }
}

export type TaskSchedulesActionState = ReturnType<typeof useTaskSchedulesActionState>
