import { get } from 'svelte/store'
import { activeProjectId } from '../../../src/lib/stores'
import { clearActiveTasks, getActiveTasksForProject, installActiveTasks } from '../../../src/lib/tasksState'
import type { ActiveTasks } from '../../../src/lib/types'
import type { StoryEnvironmentAdapter } from './storyEnvironment'

export function createStoryTaskAdapter(projectId: string, fixture: ActiveTasks): StoryEnvironmentAdapter {
  const initial = structuredClone(fixture)
  let previousProject: string | null = null
  let previous: ActiveTasks | null = null
  let installed = false
  return {
    install() {
      if (installed) return
      previousProject = get(activeProjectId)
      previous = previousProject ? getActiveTasksForProject(previousProject) : null
      installed = true
      installActiveTasks(projectId, structuredClone(initial))
    },
    reset() {
      if (!installed) throw new Error('Story task adapter must be installed before reset')
      installActiveTasks(projectId, structuredClone(initial))
    },
    dispose() {
      if (!installed) return
      installed = false
      clearActiveTasks(projectId)
      if (previousProject && previous) installActiveTasks(previousProject, previous)
    },
  }
}
