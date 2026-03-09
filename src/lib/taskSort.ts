import type { Task, AgentSession } from './types'

function getSessionTime(taskId: string, sessions: Map<string, AgentSession>): number {
  return sessions.get(taskId)?.updated_at ?? 0
}

/** Sort tasks by latest agent session activity (most recent first).
 *  Falls back to task updated_at when no session exists. */
export function sortBySessionActivity(tasks: Task[], sessions: Map<string, AgentSession>): Task[] {
  return [...tasks].sort((a, b) => {
    const aTime = getSessionTime(a.id, sessions) || a.updated_at
    const bTime = getSessionTime(b.id, sessions) || b.updated_at
    return bTime - aTime
  })
}

function getStatePriority(task: Task, session: AgentSession | null): number {
  const needsInput = session?.status === 'paused' && session?.checkpoint_data !== null
  const failed = session?.status === 'failed'
  const interrupted = session?.status === 'interrupted'
  if (needsInput || failed || interrupted) return 0
  if (session?.status === 'completed' || task.status === 'done') return 1
  if (session?.status === 'running') return 2
  return 3
}

/** Sort tasks for search results: blocked/needs-input first, then done,
 *  then running, then rest. Within each group, sort by session activity. */
export function sortForSearch(tasks: Task[], sessions: Map<string, AgentSession>): Task[] {
  return [...tasks].sort((a, b) => {
    const aPriority = getStatePriority(a, sessions.get(a.id) ?? null)
    const bPriority = getStatePriority(b, sessions.get(b.id) ?? null)
    if (aPriority !== bPriority) return aPriority - bPriority
    const aTime = getSessionTime(a.id, sessions) || a.updated_at
    const bTime = getSessionTime(b.id, sessions) || b.updated_at
    return bTime - aTime
  })
}
