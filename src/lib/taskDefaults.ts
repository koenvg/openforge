import { getConfig, getProjectConfig, getResolvedAiProvider } from './ipc'
import { computeEffectiveProjectSettings, HIERARCHICAL_SETTINGS } from './hierarchicalSettings'

export interface TaskLevelDefaults {
  taskDisplayTitleUpdatesEnabled: boolean
  aiProvider: string
  useWorktrees: boolean
}

/** Non-provider boolean settings that cascade down to the task level. */
const TASK_LEVEL_BOOL_KEYS = HIERARCHICAL_SETTINGS.filter(
  (setting) =>
    setting.control === 'toggle' && setting.levels.includes('task'),
).map((setting) => setting.key)

/**
 * Resolve the task-level defaults a new task should be seeded with, following the
 * `project ?? global ?? hardcoded default` cascade. The boolean toggles reuse the
 * shared effective-merge logic; the provider defers to the backend resolver so the
 * task inherits exactly what the runtime would resolve.
 */
export async function loadTaskLevelDefaults(projectId: string | null): Promise<TaskLevelDefaults> {
  const keys = TASK_LEVEL_BOOL_KEYS
  const [globalValues, projectValues, aiProvider] = await Promise.all([
    Promise.all(keys.map((key) => getConfig(key))),
    Promise.all(keys.map((key) => (projectId ? getProjectConfig(projectId, key) : Promise.resolve(null)))),
    projectId ? getResolvedAiProvider(projectId) : Promise.resolve('claude-code'),
  ])

  const global: Record<string, string> = {}
  const projectRaw: Record<string, string | null> = {}
  keys.forEach((key, index) => {
    const globalValue = globalValues[index]
    if (globalValue != null) global[key] = globalValue
    projectRaw[key] = projectValues[index]
  })

  const effective = computeEffectiveProjectSettings(global, projectRaw)

  return {
    taskDisplayTitleUpdatesEnabled: effective.task_display_title_metadata_updates_enabled === 'true',
    aiProvider,
    useWorktrees: effective.use_worktrees === 'true',
  }
}
