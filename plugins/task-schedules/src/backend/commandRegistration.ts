import type { SubscriptionSink } from '@openforge-app/plugin-sdk'
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import {
  cancelScheduleCommandInputSchema,
  listSchedulesCommandOutputSchema,
  scheduleCommandInputSchema,
  taskScheduleOutputSchema,
  updateScheduleCommandInputSchema,
} from '../agentCommandSchemas'
import { createManualScheduleRunner } from './scheduledFireExecution'
import { cancelScheduleFromCommand, createAgentScheduleRunner, updateScheduleFromCommand } from './scheduleCommands'
import { deleteTaskSchedule, listTaskSchedules, saveTaskSchedule } from './schedulePersistence'
import {
  requireCommandScheduleId,
  requireInvocationProjectId,
  requireProjectRequest,
  requireSaveScheduleRequest,
  requireScheduleCommandInput,
  requireScheduleIdRequest,
  requireUpdateScheduleCommandInput,
} from './requestParsing'

export const LIST_SCHEDULES_METHOD = 'listSchedules'
export const SAVE_SCHEDULE_METHOD = 'saveSchedule'
export const DELETE_SCHEDULE_METHOD = 'deleteSchedule'
export const RUN_NOW_METHOD = 'runNow'
export const CANCEL_RUN_NOW_METHOD = 'cancelRunNow'
export const SCHEDULE_COMMAND = 'schedule'
export const LIST_SCHEDULES_COMMAND = 'list-schedules'
export const UPDATE_SCHEDULE_COMMAND = 'update-schedule'
export const CANCEL_SCHEDULE_COMMAND = 'cancel-schedule'

export function registerTaskScheduleCommands(openforge: BackendOpenForgeAPI, subscriptions: SubscriptionSink): void {
  const manualRunner = createManualScheduleRunner(openforge)
  const agentScheduleRunner = createAgentScheduleRunner(openforge)

  subscriptions.add(openforge.commands.register({
    id: SCHEDULE_COMMAND,
    title: 'Schedule task automation',
    discoverable: false,
    agent: {
      description: 'Create a one-off or recurring Task Schedule for the current project.',
      examples: [
        { title: 'Resume dependency upgrade', prompt: 'Retry the dependency upgrade after its release-age gate.', timing: { type: 'once', at: '2026-08-26T13:46:00Z' } },
        { title: 'Weekly dependency review', prompt: 'Review eligible dependency updates.', timing: { type: 'recurring', cron: '0 9 * * 1' } },
      ],
    },
    input: scheduleCommandInputSchema,
    output: taskScheduleOutputSchema,
    handler: (input: unknown, invocation) => agentScheduleRunner.schedule(
      requireInvocationProjectId(invocation.projectId),
      requireScheduleCommandInput(input),
    ),
  }))
  subscriptions.add(openforge.commands.register({
    id: LIST_SCHEDULES_COMMAND,
    title: 'List task schedules',
    discoverable: false,
    agent: { description: 'List Task Schedules for the current project.' },
    output: listSchedulesCommandOutputSchema,
    handler: (_input: unknown, invocation) => listTaskSchedules(openforge, {
      projectId: requireInvocationProjectId(invocation.projectId),
    }),
  }))
  subscriptions.add(openforge.commands.register({
    id: UPDATE_SCHEDULE_COMMAND,
    title: 'Update task schedule',
    discoverable: false,
    agent: { description: 'Update an active Task Schedule in the current project.' },
    input: updateScheduleCommandInputSchema,
    output: taskScheduleOutputSchema,
    handler: (input: unknown, invocation) => updateScheduleFromCommand(
      openforge,
      requireInvocationProjectId(invocation.projectId),
      requireUpdateScheduleCommandInput(input),
    ),
  }))
  subscriptions.add(openforge.commands.register({
    id: CANCEL_SCHEDULE_COMMAND,
    title: 'Cancel task schedule',
    discoverable: false,
    agent: { description: 'Cancel a Task Schedule in the current project without deleting its record.' },
    input: cancelScheduleCommandInputSchema,
    output: taskScheduleOutputSchema,
    handler: (input: unknown, invocation) => cancelScheduleFromCommand(
      openforge,
      requireInvocationProjectId(invocation.projectId),
      requireCommandScheduleId(input),
    ),
  }))
  subscriptions.add(openforge.backend.registerMethod(LIST_SCHEDULES_METHOD, {
    handler: (input: unknown) => listTaskSchedules(openforge, requireProjectRequest(input)),
  }))
  subscriptions.add(openforge.backend.registerMethod(SAVE_SCHEDULE_METHOD, {
    handler: (input: unknown) => saveTaskSchedule(openforge, requireSaveScheduleRequest(input)),
  }))
  subscriptions.add(openforge.backend.registerMethod(DELETE_SCHEDULE_METHOD, {
    handler: async (input: unknown) => {
      const request = requireScheduleIdRequest(input)
      await deleteTaskSchedule(openforge, request)
      return { deleted: true }
    },
  }))
  subscriptions.add(openforge.backend.registerMethod(RUN_NOW_METHOD, {
    handler: (input: unknown) => manualRunner.run(requireScheduleIdRequest(input)),
  }))
  subscriptions.add(openforge.backend.registerMethod(CANCEL_RUN_NOW_METHOD, {
    handler: (input: unknown) => manualRunner.cancel(requireScheduleIdRequest(input)),
  }))
}
