import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { ScheduledFireOutcome, TaskSchedule, TaskScheduleDraft } from './types'

export const LIST_SCHEDULES_METHOD = 'listSchedules'
export const SAVE_SCHEDULE_METHOD = 'saveSchedule'
export const DELETE_SCHEDULE_METHOD = 'deleteSchedule'
export const RUN_NOW_METHOD = 'runNow'
export const CANCEL_RUN_NOW_METHOD = 'cancelRunNow'

export type CancelRunNowResult = { cancelled: boolean }

export function createTaskSchedulesIpc(api: FrontendOpenForgeAPI) {
  return {
    async list(projectId: string): Promise<TaskSchedule[]> {
      await api.backend.whenReady()
      return api.backend.invoke<TaskSchedule[]>(LIST_SCHEDULES_METHOD, { projectId })
    },
    save(projectId: string, schedule: TaskScheduleDraft): Promise<TaskSchedule> {
      return api.backend.invoke<TaskSchedule>(SAVE_SCHEDULE_METHOD, { projectId, schedule })
    },
    delete(projectId: string, scheduleId: string): Promise<void> {
      return api.backend.invoke<void>(DELETE_SCHEDULE_METHOD, { projectId, scheduleId })
    },
    runNow(projectId: string, scheduleId: string): Promise<ScheduledFireOutcome> {
      return api.backend.invoke<ScheduledFireOutcome>(RUN_NOW_METHOD, { projectId, scheduleId })
    },
    cancelRunNow(projectId: string, scheduleId: string): Promise<CancelRunNowResult> {
      return api.backend.invoke<CancelRunNowResult>(CANCEL_RUN_NOW_METHOD, { projectId, scheduleId })
    },
  }
}
