import type { AgentSession } from './types'

export type OpenCodeSessionUpdate = Partial<Pick<AgentSession, 'status' | 'checkpoint_data' | 'error_message'>>

export function getOpenCodeSessionUpdate(eventType: string, data: string): OpenCodeSessionUpdate | null {
  if (eventType === 'session.idle') {
    return null
  }

  if (eventType === 'session.status') {
    try {
      const parsed = JSON.parse(data)
      const statusType = parsed.properties?.status?.type

      if (statusType === 'busy' || statusType === 'retry') {
        return {
          status: 'running',
          checkpoint_data: null,
        }
      }

      return null
    } catch {
      return null
    }
  }

  if (eventType === 'session.error') {
    return {
      status: 'failed',
      error_message: data,
    }
  }

  if (eventType === 'permission.updated' || eventType === 'question.asked') {
    return {
      status: 'paused',
      checkpoint_data: data,
    }
  }

  if (eventType === 'permission.replied' || eventType === 'question.answered') {
    return {
      status: 'running',
      checkpoint_data: null,
    }
  }

  return null
}
