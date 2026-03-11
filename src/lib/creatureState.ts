import type { Task, AgentSession, PullRequestInfo } from './types'
import { computeTaskState } from './taskState'

export type { TaskState as CreatureState } from './taskState'
export { computeTaskState as computeCreatureState } from './taskState'

export type CreatureRoom = 'forge' | 'warRoom' | 'nursery'

export function computeCreatureRoom(task: Task, session: AgentSession | null, prs: PullRequestInfo[]): CreatureRoom {
  const state = computeTaskState(task, session, prs)

  if (task.status === 'backlog') return 'nursery'
  if (state === 'ci-failed' || state === 'changes-requested') return 'warRoom'
  if (state === 'needs-input' || state === 'resting' || state === 'sad' || state === 'frozen') return 'warRoom'
  return 'forge'
}
