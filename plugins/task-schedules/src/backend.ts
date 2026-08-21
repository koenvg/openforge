import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'
import { registerTaskScheduleCommands } from './backend/commandRegistration'
import { createScheduledFiresService } from './backend/scheduledFireExecution'

export default defineBackendPlugin({
  activate(openforge, context) {
    registerTaskScheduleCommands(openforge, context.subscriptions)
    context.subscriptions.add(openforge.background.register(createScheduledFiresService(openforge)))
  },
})

export {
  CANCEL_RUN_NOW_METHOD,
  CANCEL_SCHEDULE_COMMAND,
  DELETE_SCHEDULE_METHOD,
  LIST_SCHEDULES_COMMAND,
  LIST_SCHEDULES_METHOD,
  RUN_NOW_METHOD,
  SAVE_SCHEDULE_METHOD,
  SCHEDULE_COMMAND,
  UPDATE_SCHEDULE_COMMAND,
  registerTaskScheduleCommands,
} from './backend/commandRegistration'
export {
  cancelScheduleFromCommand,
  scheduleTaskFromCommand,
  updateScheduleFromCommand,
} from './backend/scheduleCommands'
export {
  SCHEDULES_STORAGE_KEY,
  deleteTaskSchedule,
  listTaskSchedules,
  saveTaskSchedule,
} from './backend/schedulePersistence'
export type {
  ProjectRequest,
  SaveScheduleRequest,
  ScheduleIdRequest,
} from './backend/schedulePersistence'
export {
  createGuardedPoll,
  createManualScheduleRunner,
  createScheduledFiresService,
  processDueSchedules,
  processDueSchedulesForAllProjects,
  runScheduleNow,
} from './backend/scheduledFireExecution'
export type { ManualScheduleRunner } from './backend/scheduledFireExecution'
