import type { Task, AgentSession } from './types'

export interface DoingStatus {
  doingCount: number
  hasNeedsAnswer: boolean
  hasRunning: boolean
  allDone: boolean
}

export function computeDoingStatus(tasks: Task[], sessions: Map<string, AgentSession>): DoingStatus {
  const doingTasks = tasks.filter(t => t.status === 'doing')
  const doingCount = doingTasks.length

  const hasNeedsAnswer = doingTasks.some(t => {
    const session = sessions.get(t.id)
    return session?.status === 'paused' && session?.checkpoint_data !== null
  })

  const hasRunning = doingTasks.some(t => {
    const session = sessions.get(t.id)
    return session?.status === 'running'
  })

  const allDone = doingCount > 0 && doingTasks.every(t => {
    const session = sessions.get(t.id)
    return session?.status === 'completed'
  })

  return { doingCount, hasNeedsAnswer, hasRunning, allDone }
}
