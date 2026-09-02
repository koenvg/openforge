import { get } from 'svelte/store'
import { shouldHydratePtyInstanceFromAgentStatusMetadata } from '../agentPanelSessionSync'
import type { AgentStatusChangedKind } from '../agentPanelSessionSync'
import { finalizeAgentSession, getLatestSession } from '../ipc'
import { getOpenCodeSessionUpdate } from '../opencodeSessionEvents'
import {
  activeProjectId,
  activeSessions,
  checkpointNotification,
  selectedTaskId,
  taskRuntimeInfo,
  taskSpawned,
  taskDetailsById,
  tasks,
} from '../stores'
import { evictTask, getVisibleRelationshipOwner, loadTaskDetail } from '../tasksState'
import { agentTerminalSessions } from '../terminalSessionService'
import type { AgentSession } from '../types'
import { defineDesktopEventListener } from './types'
import type { AppDesktopEventDeps } from './types'

type TaskSessionEventDeps = Pick<
  AppDesktopEventDeps,
  'loadTasks' | 'loadSessions' | 'loadPullRequests' | 'loadProjectAttention' | 'publishTaskInvalidation'
>

function setActiveSession(taskId: string, session: AgentSession): void {
  const updated = new Map(get(activeSessions))
  updated.set(taskId, session)
  activeSessions.set(updated)
}

function deleteActiveSession(taskId: string): void {
  const updated = new Map(get(activeSessions))
  updated.delete(taskId)
  activeSessions.set(updated)
}

function clearCheckpointForTask(taskId: string): void {
  if (get(checkpointNotification)?.ticketId === taskId) {
    checkpointNotification.set(null)
  }
}

function hydratePtyInstanceFromStatusMetadata(
  taskId: string,
  status: string,
  kind: AgentStatusChangedKind | null | undefined,
  ptyInstanceId: number | null | undefined,
): void {
  if (typeof ptyInstanceId !== 'number') return
  if (!shouldHydratePtyInstanceFromAgentStatusMetadata(status, kind)) return

  void agentTerminalSessions.restorePtyInstance(taskId, ptyInstanceId)
}

function setAgentNeedsPermissionNotification(taskId: string, session: AgentSession): boolean {
  const message = 'Agent needs permission'
  const existingNotification = get(checkpointNotification)
  if (
    existingNotification?.ticketId === taskId &&
    existingNotification.sessionId === session.id &&
    existingNotification.stage === session.stage &&
    existingNotification.message === message
  ) {
    return false
  }

  const task = get(tasks).find(task => task.id === taskId)
  checkpointNotification.set({
    ticketId: taskId,
    ticketKey: task?.id ?? null,
    sessionId: session.id,
    stage: session.stage,
    message,
    timestamp: Date.now(),
  })
  return true
}

async function getOrLoadActiveSession(taskId: string): Promise<AgentSession | null> {
  const existing = get(activeSessions).get(taskId)
  if (existing) return existing

  try {
    const fetched = await getLatestSession(taskId)
    if (!fetched) return null

    setActiveSession(taskId, fetched)
    return fetched
  } catch {
    return null
  }
}

async function hydratePersistedStoppedSession(taskId: string, status: string | undefined): Promise<void> {
  if (!status || !['completed', 'paused', 'failed', 'interrupted'].includes(status)) return

  try {
    const persistedSession = await getLatestSession(taskId)
    if (persistedSession?.status === status) setActiveSession(taskId, persistedSession)
  } catch {
    // Keep the event-applied status; the next lifecycle or attention refresh can retry.
  }
}

export function createTaskSessionEventListeners(deps: TaskSessionEventDeps) {
  return {
    actionComplete: defineDesktopEventListener('action-complete', async (event) => {
      const taskId = event.payload.task_id
      const session = await getOrLoadActiveSession(taskId)
      if (session && session.status !== 'completed') {
        setActiveSession(taskId, { ...session, status: 'completed', checkpoint_data: null })
      }
      clearCheckpointForTask(taskId)
      void deps.loadTasks()
      await hydratePersistedStoppedSession(taskId, 'completed')
      void deps.loadProjectAttention()
      await deps.publishTaskInvalidation?.({ taskId, reason: 'execution' })
    }),

    implementationFailed: defineDesktopEventListener(
      'implementation-failed',
      async (event) => {
        const taskId = event.payload.task_id
        const session = get(activeSessions).get(taskId)
        if (session && session.status !== 'failed') {
          setActiveSession(taskId, { ...session, status: 'failed', error_message: event.payload.error })
        }
        clearCheckpointForTask(taskId)
        void deps.loadTasks()
        await hydratePersistedStoppedSession(taskId, 'failed')
        void deps.loadProjectAttention()
        await deps.publishTaskInvalidation?.({ taskId, reason: 'execution' })
      },
    ),

    sessionResumed: defineDesktopEventListener(
      'session-resumed',
      async (event) => {
        const taskId = event.payload.task_id
        if (typeof event.payload.pty_instance_id === 'number') {
          await agentTerminalSessions.restorePtyInstance(taskId, event.payload.pty_instance_id)
        }
        const updatedRuntimeInfo = new Map(get(taskRuntimeInfo))
        updatedRuntimeInfo.set(taskId, {
          workspacePath: event.payload.workspace_path,
        })
        taskRuntimeInfo.set(updatedRuntimeInfo)

        try {
          const session = await getLatestSession(taskId)
          if (session) {
            setActiveSession(taskId, session)
          }
        } catch (e) {
          console.error('[startup] Failed to load session after resume for task:', taskId, e)
        }
        await deps.publishTaskInvalidation?.({ taskId, reason: 'execution' })
      },
    ),

    startupResumeComplete: defineDesktopEventListener('startup-resume-complete', () => {
      void deps.loadSessions()
    }),

    agentEvent: defineDesktopEventListener('agent-event', async (event) => {
      const { task_id: taskId, event_type: eventType } = event.payload
      const session = await getOrLoadActiveSession(taskId)
      if (!session) {
        await deps.publishTaskInvalidation?.({ taskId, reason: 'attention' })
        return
      }

      const sessionUpdate = getOpenCodeSessionUpdate(eventType, event.payload.data)
      if (!sessionUpdate) {
        void deps.loadProjectAttention()
        await deps.publishTaskInvalidation?.({ taskId, reason: 'attention' })
        return
      }

      if (sessionUpdate.status === 'paused') {
        if (session.status === 'paused' && session.checkpoint_data === sessionUpdate.checkpoint_data) {
          await hydratePersistedStoppedSession(taskId, sessionUpdate.status)
          void deps.loadProjectAttention()
          await deps.publishTaskInvalidation?.({ taskId, reason: 'attention' })
          return
        }

        setActiveSession(taskId, { ...session, ...sessionUpdate })

        const task = get(tasks).find(task => task.id === taskId)
        checkpointNotification.set({
          ticketId: taskId,
          ticketKey: task?.id ?? null,
          sessionId: session.id,
          stage: session.stage,
          message: 'Agent needs input',
          timestamp: Date.now(),
        })
      } else {
        if (
          session.status === sessionUpdate.status &&
          session.checkpoint_data === sessionUpdate.checkpoint_data &&
          session.error_message === sessionUpdate.error_message
        ) {
          await hydratePersistedStoppedSession(taskId, sessionUpdate.status)
          void deps.loadProjectAttention()
          await deps.publishTaskInvalidation?.({ taskId, reason: 'attention' })
          return
        }

        setActiveSession(taskId, { ...session, ...sessionUpdate })
        clearCheckpointForTask(taskId)
      }

      await hydratePersistedStoppedSession(taskId, sessionUpdate.status)
      void deps.loadProjectAttention()
      await deps.publishTaskInvalidation?.({ taskId, reason: 'attention' })
    }),

    sessionAborted: defineDesktopEventListener(
      'session-aborted',
      async (event) => {
        const taskId = event.payload.ticket_id
        deleteActiveSession(taskId)
        agentTerminalSessions.release(taskId)
        clearCheckpointForTask(taskId)
        void deps.loadProjectAttention()
        await deps.publishTaskInvalidation?.({ taskId, reason: 'execution' })
      },
    ),

    agentStatusChanged: defineDesktopEventListener('agent-status-changed', async (event) => {
      const { task_id: taskId, status } = event.payload
      hydratePtyInstanceFromStatusMetadata(
        taskId,
        status,
        event.payload.kind,
        event.payload.pty_instance_id,
      )
      let session = get(activeSessions).get(taskId)
      if (!session) {
        try {
          const fetched = await getLatestSession(taskId)
          if (fetched) {
            session = fetched
            setActiveSession(taskId, fetched)
          } else {
            return
          }
        } catch {
          return
        }
      }

      if (status === 'completed') {
        if (session.status !== 'completed') {
          setActiveSession(taskId, { ...session, status: 'completed' })
          clearCheckpointForTask(taskId)
          void deps.loadTasks()
        }
      } else if (status === 'running') {
        if (session.status !== 'running') {
          setActiveSession(taskId, { ...session, status: 'running', checkpoint_data: null })
          clearCheckpointForTask(taskId)
        }
      } else if (status === 'paused') {
        if (session.status !== 'paused') {
          setActiveSession(taskId, { ...session, status: 'paused' })
        }
        setAgentNeedsPermissionNotification(taskId, session)
      } else if (status === 'interrupted') {
        if (session.status !== 'interrupted') {
          setActiveSession(taskId, { ...session, status: 'interrupted' })
          clearCheckpointForTask(taskId)
          void deps.loadTasks()
        }
      } else if (status === 'failed') {
        if (session.status !== 'failed') {
          setActiveSession(taskId, { ...session, status: 'failed', checkpoint_data: null })
          clearCheckpointForTask(taskId)
          void deps.loadTasks()
        }
      }
      await hydratePersistedStoppedSession(taskId, status)
      void deps.loadProjectAttention()
      await deps.publishTaskInvalidation?.({
        taskId,
        reason: status === 'paused' || event.payload.kind === 'requested_permission'
          ? 'attention'
          : 'execution',
      })
    }),

    agentPtyExited: defineDesktopEventListener('agent-pty-exited', (event) => {
      const taskId = event.payload.task_id
      const success = event.payload.success
      const ptyInstanceId = event.payload.instance_id
      setTimeout(async () => {
        try {
          await finalizeAgentSession(taskId, success, ptyInstanceId)
        } catch (e) {
          console.error('[pty-exit] Failed to finalize session for task:', taskId, e)
        }
      }, 1500)
    }),

    taskChanged: defineDesktopEventListener(
      'task-changed',
      async (event) => {
        const taskId = event.payload.task_id
        const observedProjectId = event.payload.project_id
          ?? get(taskDetailsById).get(taskId)?.projectId
          ?? get(tasks).find((task) => task.id === taskId)?.projectId
        if (event.payload.action === 'deleted') {
          evictTask(taskId)
          deleteActiveSession(taskId)
          agentTerminalSessions.release(taskId)
          clearCheckpointForTask(taskId)
        } else if (event.payload.action === 'created') {
          const projectId = event.payload.project_id ?? get(activeProjectId)
          if (projectId) {
            try {
              const result = await loadTaskDetail(projectId, taskId)
              if (result) taskSpawned.set({ taskId, promptText: result.task.prompt })
            } catch (loadError) {
              console.error('Failed to load created task for toast:', loadError)
            }
          }
        } else {
          const visibleOwnerId = getVisibleRelationshipOwner(taskId)
          const changedCachedTaskId = get(taskDetailsById).has(taskId)
            && !get(tasks).some((task) => task.id === taskId)
            ? taskId
            : null
          const refreshTaskIds = [...new Set(
            [changedCachedTaskId, visibleOwnerId].filter((candidate): candidate is string => Boolean(candidate)),
          )]
          const expectedProjectId = get(activeProjectId)
          const expectedSelectedTaskId = get(selectedTaskId)
          if (expectedProjectId) {
            for (const refreshTaskId of refreshTaskIds) {
              try {
                await loadTaskDetail(
                  expectedProjectId,
                  refreshTaskId,
                  undefined,
                  () => get(activeProjectId) === expectedProjectId
                    && get(selectedTaskId) === expectedSelectedTaskId,
                )
              } catch (loadError) {
                console.error('Failed to refresh changed task detail:', loadError)
              }
            }
          }
        }
        await deps.loadTasks()
        await deps.loadPullRequests()
        await deps.loadProjectAttention()
        await deps.publishTaskInvalidation?.({
          projectId: observedProjectId,
          taskId,
          reason: event.payload.action === 'created'
            ? 'created'
            : event.payload.action === 'deleted' ? 'completed' : 'updated',
        })
      },
    ),
  }
}
