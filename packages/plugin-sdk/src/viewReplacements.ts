import type { Project, TaskDetail, TaskReference } from './domain.js'
import type {
  Disposable,
  FrontendOpenForgeAPI,
  OpenForgeContextSnapshot,
  PluginComponent,
  PluginComponentLoader,
  PluginIcon,
} from './types.js'

export type ReplaceableViewTarget = 'project.dashboard' | 'task.detail'

export interface PluginProjectDashboardReplacementProps extends Record<string, unknown> {
  api: FrontendOpenForgeAPI
  context: OpenForgeContextSnapshot
  project: Project
  onOpenTask: (taskId: string) => void | Promise<void>
  onComposeTask: () => void
  onOpenCommandSearch: () => void
}

export interface PluginTaskDetailReplacementProps extends Record<string, unknown> {
  api: FrontendOpenForgeAPI
  context: OpenForgeContextSnapshot
  project: Project
  task: TaskDetail
  relatedTasks: TaskReference[]
  onOpenTask: (taskId: string, projectId?: string | null) => void | Promise<void>
  onEditTask: () => void
  onOpenTaskActions: () => void
  onRefreshTask: () => void | Promise<void>
}

export interface PluginProjectDashboardReplacementRegistration {
  id: string
  target: 'project.dashboard'
  title: string
  icon: PluginIcon
  component:
    | PluginComponentLoader<PluginProjectDashboardReplacementProps>
    | PluginComponent<PluginProjectDashboardReplacementProps>
}

export interface PluginTaskDetailReplacementRegistration {
  id: string
  target: 'task.detail'
  title: string
  component:
    | PluginComponentLoader<PluginTaskDetailReplacementProps>
    | PluginComponent<PluginTaskDetailReplacementProps>
}

export type PluginViewReplacementRegistration =
  | PluginProjectDashboardReplacementRegistration
  | PluginTaskDetailReplacementRegistration

export interface FrontendViewReplacementRegistry {
  register(registration: PluginViewReplacementRegistration): Disposable
}
