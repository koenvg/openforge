import { resetProjectSettingsToGlobal } from './ipc'
import type { Project } from './types'

export interface ProjectIdentity {
  projectName: string
  projectPath: string
}

interface UpdatedProjectIdentity {
  id: string
  name: string
  path: string
}

export function getProjectIdentity(projectId: string | null, projectList: Project[]): ProjectIdentity {
  if (!projectId) {
    return {
      projectName: '',
      projectPath: '',
    }
  }

  const project = projectList.find((candidate) => candidate.id === projectId)

  return {
    projectName: project?.name ?? '',
    projectPath: project?.path ?? '',
  }
}

export function mergeUpdatedProject(projectList: Project[], updatedProject: UpdatedProjectIdentity): Project[] {
  return projectList.map((project) =>
    project.id === updatedProject.id
      ? { ...project, name: updatedProject.name, path: updatedProject.path }
      : project
  )
}

/**
 * Clear a project's unified-settings overrides so it re-inherits global defaults,
 * then re-run the caller's project-settings load so the UI shows the re-inherited
 * effective values.
 */
export async function resetProjectAndReload(
  projectId: string,
  reload: () => Promise<void>,
): Promise<void> {
  await resetProjectSettingsToGlobal(projectId)
  await reload()
}
