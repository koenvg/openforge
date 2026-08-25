import { get } from 'svelte/store'
import { shouldHydratePtyInstanceFromAgentStatusMetadata } from '../agentPanelSessionSync'
import type { AgentStatusChangedKind } from '../agentPanelSessionSync'
import { finalizeAgentSession, getLatestSession, getTaskDetail } from '../ipc'
import { getOpenCodeSessionUpdate } from '../opencodeSessionEvents'
import {
  activeSessions,
  checkpointNotification,
  taskRuntimeInfo,
  taskSpawned,
  tasks,
} from '../stores'
import {
  getShellLifecycleState,
  release as releaseTerminal,
  restorePtyInstance,
  updateShellLifecycleState,
} from '../terminalPool'
import { getTaskPromptText } from '../taskPrompt'
import type { AgentSession } from '../types'
import { defineDesktopEventListener } from './types'
import type { AppDesktopEventDeps } from './types'

type TaskSessionEventDeps = Pick<
  AppDesktopEventDeps,
  'loadTasks' | 'loadSessions' | 'loadPullRequests' | 'loadProjectAttention'
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

  updateShellLifecycleState(taskId, {
    ...getShellLifecycleState(taskId),
    ptyActive: true,
    shellExited: false,
    currentPtyInstance: ptyInstanceId,
  })
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
      void deps.loadProjectAttention()
    }),

    implementationFailed: defineDesktopEventListener(
      'implementation-failed',
      (event) => {
        const taskId = event.payload.task_id
        const session = get(activeSessions).get(taskId)
        if (session) {
          if (session.status === 'failed') return
          setActiveSession(taskId, { ...session, status: 'failed', error_message: event.payload.error })
        }
        clearCheckpointForTask(taskId)
        void deps.loadTasks()
        void deps.loadProjectAttention()
      },
    ),

    sessionResumed: defineDesktopEventListener(
      'session-resumed',
      async (event) => {
        const taskId = event.payload.task_id
        if (typeof event.payload.pty_instance_id === 'number') {
          restorePtyInstance(taskId, event.payload.pty_instance_id)
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
      },
    ),

    startupResumeComplete: defineDesktopEventListener('startup-resume-complete', () => {
      void deps.loadSessions()
    }),

    agentEvent: defineDesktopEventListener('agent-event', async (event) => {
      const { task_id: taskId, event_type: eventType } = event.payload
      const session = await getOrLoadActiveSession(taskId)
      if (!session) return

      const sessionUpdate = getOpenCodeSessionUpdate(eventType, event.payload.data)
      if (!sessionUpdate) {
        void deps.loadProjectAttention()
        return
      }

      if (sessionUpdate.status === 'paused') {
        if (session.status === 'paused' && session.checkpoint_data === sessionUpdate.checkpoint_data) return

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
          void deps.loadProjectAttention()
          return
        }

        setActiveSession(taskId, { ...session, ...sessionUpdate })
        clearCheckpointForTask(taskId)
      }

      void deps.loadProjectAttention()
    }),

    sessionAborted: defineDesktopEventListener(
      'session-aborted',
      (event) => {
        deleteActiveSession(event.payload.ticket_id)
        releaseTerminal(event.payload.ticket_id)
        clearCheckpointForTask(event.payload.ticket_id)
        void deps.loadProjectAttention()
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
      void deps.loadProjectAttention()
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
        if (event.payload.action === 'deleted') {
          const taskId = event.payload.task_id
          deleteActiveSession(taskId)
          releaseTerminal(taskId)
          clearCheckpointForTask(taskId)
        } else if (event.payload.action === 'created') {
          try {
            const task = await getTaskDetail(event.payload.task_id)
            taskSpawned.set({ taskId: task.id, promptText: getTaskPromptText(task) })
          } catch (e) {
            console.error('Failed to load created task for toast:', e)
          }
        }
        await deps.loadTasks()
        await deps.loadPullRequests()
        await deps.loadProjectAttention()
      },
    ),
  }
}
