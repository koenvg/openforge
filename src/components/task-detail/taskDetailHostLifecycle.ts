import type { TaskRunAppState } from './taskRunAppController'

export interface TaskDetailHostLifecycleState {
  workspacePath: string | null
  runAppState: TaskRunAppState
  runApp: () => Promise<void>
}
